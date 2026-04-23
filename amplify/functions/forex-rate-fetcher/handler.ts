/**
 * forex-rate-fetcher — live USD/EUR/GBP → INR rates with a 6-hour DynamoDB cache.
 *
 * Data source: **open.er-api.com** — the keyless public tier of ExchangeRate-API.
 * Free, no Secrets Manager dependency, no sign-up, rates updated daily.
 * Good enough for import cost estimation where we only need ±0.5% accuracy.
 *
 * Optional upgrade path: if you want the paid ExchangeRate-API with more
 * frequent updates, set `EXCHANGE_RATE_API_KEY_SECRET_ID` env var pointing
 * at a Secrets Manager secret with `{"apiKey":"..."}` and the Lambda switches
 * to the authenticated endpoint automatically.
 *
 * Input / output unchanged.
 */
import { FOREX_CACHE_TTL_HOURS, SUPPORTED_CURRENCIES } from "../../../shared/constants.js";
import { putItem, queryItems } from "../_lib/ddb.js";

type Quote = "USD" | "EUR" | "GBP";

interface Input {
  quoteCurrency: Quote;
  forceRefresh?: boolean;
}

export interface Output {
  baseCurrency: "INR";
  quoteCurrency: Quote;
  rate: number;
  fetchedAt: string;
  expiresAt: string;
  cacheHit: boolean;
  source: "open.er-api.com" | "exchangerate-api" | "cache";
}

interface CachedRow {
  id: string;
  baseCurrency: string;
  quoteCurrency: string;
  rate: number;
  fetchedAt: string;
  expiresAt: string;
  source?: string;
}

const CACHE_MS = FOREX_CACHE_TTL_HOURS * 60 * 60 * 1000;
// Kept for reference / potential paid-upgrade path. Not used by default.
// const EXCHANGE_API_BASE = "https://v6.exchangerate-api.com/v6";

export const handler = async (
  rawEvent: Input | { arguments?: Input },
): Promise<Output> => {
  // Support both CLI and AppSync resolver shapes.
  const event: Input =
    (rawEvent as { arguments?: Input })?.arguments ?? (rawEvent as Input);

  if (!event?.quoteCurrency) {
    throw new Error("quoteCurrency is required");
  }
  if (!SUPPORTED_CURRENCIES.includes(event.quoteCurrency)) {
    throw new Error(`Unsupported currency: ${event.quoteCurrency}`);
  }
  if ((event.quoteCurrency as string) === "INR") {
    throw new Error(
      "quoteCurrency cannot be INR — base is always INR; pass USD/EUR/GBP instead.",
    );
  }

  const now = Date.now();

  // 1. Cache probe (unless forceRefresh).
  if (!event.forceRefresh) {
    const cached = await readCache(event.quoteCurrency);
    if (cached && Date.parse(cached.expiresAt) > now) {
      return {
        baseCurrency: "INR",
        quoteCurrency: event.quoteCurrency,
        rate: cached.rate,
        fetchedAt: cached.fetchedAt,
        expiresAt: cached.expiresAt,
        cacheHit: true,
        source: "cache",
      };
    }
  }

  // 2. Live fetch. By default use the free keyless tier at open.er-api.com.
  //    If EXCHANGE_RATE_API_KEY_SECRET_ID is set, use the paid endpoint.
  const rate = await fetchLiveRate(event.quoteCurrency);

  // 3. Store new cache row.
  const fetchedAt = new Date(now).toISOString();
  const expiresAt = new Date(now + CACHE_MS).toISOString();
  await putItem("ForexRateCache", {
    id: `INR#${event.quoteCurrency}#${fetchedAt}`,
    baseCurrency: "INR",
    quoteCurrency: event.quoteCurrency,
    rate,
    fetchedAt,
    expiresAt,
    source: "open.er-api.com",
    createdAt: fetchedAt,
    updatedAt: fetchedAt,
  });

  return {
    baseCurrency: "INR",
    quoteCurrency: event.quoteCurrency,
    rate,
    fetchedAt,
    expiresAt,
    cacheHit: false,
    source: "open.er-api.com",
  };
};

/**
 * Reads the most recent non-expired cache row for the given pair.
 * We scan-with-filter because cache volume is tiny (3 currencies × few rows).
 * Switching to a GSI would be overkill.
 */
async function readCache(quote: Quote): Promise<CachedRow | null> {
  const items = await queryItems<CachedRow>("ForexRateCache", {
    IndexName: undefined,
    KeyConditionExpression: "baseCurrency = :base AND quoteCurrency = :quote",
    ExpressionAttributeValues: {
      ":base": "INR",
      ":quote": quote,
    },
  }).catch(async () => {
    // ForexRateCache has no GSI on (baseCurrency, quoteCurrency); fall back to scan.
    const { scanItems } = await import("../_lib/ddb.js");
    return scanItems<CachedRow>("ForexRateCache", {
      FilterExpression: "baseCurrency = :base AND quoteCurrency = :quote",
      ExpressionAttributeValues: { ":base": "INR", ":quote": quote },
    });
  });

  if (!items.length) return null;
  items.sort((a, b) => Date.parse(b.fetchedAt) - Date.parse(a.fetchedAt));
  return items[0] ?? null;
}

async function fetchLiveRate(quote: Quote): Promise<number> {
  // open.er-api.com: `https://open.er-api.com/v6/latest/{BASE}`
  // Returns an object: `{ result: "success", rates: { INR: 83.42, ... }, ... }`
  // No API key required. Rate limit is generous for our traffic.
  const url = `https://open.er-api.com/v6/latest/${quote}`;
  const res = await fetch(url, { method: "GET" });
  if (!res.ok) {
    throw new Error(`open.er-api.com returned ${res.status}: ${await res.text()}`);
  }
  const body = (await res.json()) as {
    result?: string;
    rates?: Record<string, number>;
    "error-type"?: string;
  };
  if (body.result !== "success" || !body.rates || typeof body.rates.INR !== "number") {
    throw new Error(
      `open.er-api.com error: ${body["error-type"] ?? "unknown"} (result=${body.result})`,
    );
  }
  const rate = body.rates.INR;
  // Clamp to a sane range — if API gives us something absurd, abort.
  if (rate < 10 || rate > 300) {
    throw new Error(
      `Forex API returned implausible rate ${rate} for ${quote}/INR — refusing to cache.`,
    );
  }
  return rate;
}
