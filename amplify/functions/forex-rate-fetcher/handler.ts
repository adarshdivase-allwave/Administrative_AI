/**
 * forex-rate-fetcher — live USD/EUR/GBP → INR rates with a 6-hour DynamoDB cache.
 *
 * Input shape (AppSync direct resolver or internal Lambda invoke):
 *   { quoteCurrency: "USD" | "EUR" | "GBP", forceRefresh?: boolean }
 *
 * Output:
 *   {
 *     baseCurrency: "INR",
 *     quoteCurrency: "USD" | "EUR" | "GBP",
 *     rate: number,          // 1 <quote> = <rate> INR
 *     fetchedAt: ISO8601,
 *     expiresAt: ISO8601,
 *     cacheHit: boolean,
 *     source: "exchangerate-api" | "cache"
 *   }
 *
 * Behavior:
 *   - On cache hit (entry exists AND expiresAt > now AND !forceRefresh): return cached.
 *   - On cache miss / stale / forceRefresh: fetch from ExchangeRate-API,
 *     store a new ForexRateCache row with TTL 6h, return.
 *   - API failures surface as structured errors — caller (frontend) shows
 *     "rate unavailable" with the most recent cached entry as a fallback.
 *
 * Cached by (baseCurrency=INR, quoteCurrency) pair.
 */
import { FOREX_CACHE_TTL_HOURS, SUPPORTED_CURRENCIES } from "../../../shared/constants.js";
import { getSecretField } from "../_lib/secrets.js";
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
  source: "exchangerate-api" | "cache";
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
const EXCHANGE_API_BASE = "https://v6.exchangerate-api.com/v6";

export const handler = async (event: Input): Promise<Output> => {
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

  // 2. Live fetch from ExchangeRate-API.
  const apiKey = await getSecretField(
    process.env.EXCHANGE_RATE_SECRET_ID ?? "av-inventory/exchangerate-api-key",
    "apiKey",
  );
  const rate = await fetchLiveRate(apiKey, event.quoteCurrency);

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
    source: "exchangerate-api",
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
    source: "exchangerate-api",
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

async function fetchLiveRate(apiKey: string, quote: Quote): Promise<number> {
  // ExchangeRate-API v6: /v6/{KEY}/pair/{FROM}/{TO}
  // The "from" is the foreign currency and "to" is INR, so that a rate of X
  // means 1 FOREIGN = X INR (which matches how we store it).
  const url = `${EXCHANGE_API_BASE}/${apiKey}/pair/${quote}/INR`;
  const res = await fetch(url, { method: "GET" });
  if (!res.ok) {
    throw new Error(`ExchangeRate-API returned ${res.status}: ${await res.text()}`);
  }
  const body = (await res.json()) as {
    result?: string;
    conversion_rate?: number;
    "error-type"?: string;
  };
  if (body.result !== "success" || typeof body.conversion_rate !== "number") {
    throw new Error(
      `ExchangeRate-API error: ${body["error-type"] ?? "unknown"} (result=${body.result})`,
    );
  }
  // Clamp to a sane range — if API gives us something absurd, abort rather
  // than contaminate GRNs with bad cost calculations.
  if (body.conversion_rate < 10 || body.conversion_rate > 300) {
    throw new Error(
      `ExchangeRate-API returned implausible rate ${body.conversion_rate} for ${quote}/INR — refusing to cache.`,
    );
  }
  return body.conversion_rate;
}
