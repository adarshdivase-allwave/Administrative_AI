/**
 * hsn-validator — resolves a product/HSN combination against India's GST
 * HSN/SAC schedule, with AI fallback.
 *
 * Pipeline:
 *   1. Format check via shared/hsn.ts (4/6/8-digit HSN, 6-digit 99-prefix SAC)
 *   2. DynamoDB lookup in the HSNDatabase table (seeded by scripts/seed-hsn.ts)
 *   3. OpenSearch lookup (ONLY if USE_OPENSEARCH=1 + endpoint configured —
 *      retained for orgs that want premium fuzzy search; off by default)
 *   4. If miss: Gemini (default gemini-2.5-flash, env-configurable via
 *      GEMINI_MODEL) with Google Search grounding → returns suggested code
 *
 * Input / output as before.
 *
 * Why DynamoDB-first: the HSNDatabase table holds all ~12k India GST codes
 * seeded by `seed-hsn.ts`. A keyed GetItem returns in ~10-20ms with no
 * extra infra. OpenSearch Serverless is expensive (~$180/mo idle) and was
 * only marginally faster; not worth it for this dataset scale.
 */
import { validateHsn, normalizeHsnForTally } from "../../../shared/hsn.js";
import { getSecretField } from "../_lib/secrets.js";
import { getItem } from "../_lib/ddb.js";

interface Input {
  hsnCode?: string;
  productName?: string;
  productSpecs?: string;
}

export interface Output {
  status: "VALID" | "INVALID" | "AI_SUGGESTED";
  hsnCode: string;
  description: string;
  gstRatePercent: number;
  tallyFormat: string;
  tallyCompatible: boolean;
  isSac: boolean;
  sourceUrl?: string;
  sourceDomain?: string;
  error?: string;
}

// Env vars read lazily so tests can override them in `beforeEach`.
const getOpenSearchEndpoint = () =>
  process.env.USE_OPENSEARCH === "1" ? (process.env.OPENSEARCH_COLLECTION_ENDPOINT ?? "") : "";
const getHsnIndex = () => process.env.OPENSEARCH_HSN_INDEX ?? "hsn-india-gst";

export const handler = async (rawEvent: Input | { arguments?: Input }): Promise<Output> => {
  // Support both CLI-invoke (`{hsnCode: ...}`) and AppSync resolver shape
  // (`{arguments: {hsnCode: ...}, identity, ...}`).
  const event: Input = (rawEvent as { arguments?: Input })?.arguments ?? (rawEvent as Input);

  if (!event?.hsnCode && !event?.productName) {
    throw new Error("Either hsnCode or productName is required");
  }

  // ---- Path 1: user gave an HSN code — validate + look it up ----
  if (event.hsnCode) {
    const formatCheck = validateHsn(event.hsnCode);
    if (!formatCheck.valid) {
      return {
        status: "INVALID",
        hsnCode: event.hsnCode,
        description: "",
        gstRatePercent: 0,
        tallyFormat: formatCheck.tallyFormat,
        tallyCompatible: false,
        isSac: false,
        error: formatCheck.error,
      };
    }

    // 1. DynamoDB lookup first (always available, free tier, ~10-20ms).
    const ddbRow = await lookupInDynamo(formatCheck.tallyFormat);
    if (ddbRow) {
      return {
        status: "VALID",
        hsnCode: formatCheck.tallyFormat,
        description: ddbRow.description,
        gstRatePercent: ddbRow.gstRatePercent,
        tallyFormat: formatCheck.tallyFormat,
        tallyCompatible: true,
        isSac: formatCheck.isSac,
      };
    }

    // 2. Optional OpenSearch (only if explicitly enabled via USE_OPENSEARCH=1).
    const row = await lookupInOpenSearch(formatCheck.tallyFormat);
    if (row) {
      return {
        status: "VALID",
        hsnCode: formatCheck.tallyFormat,
        description: row.description,
        gstRatePercent: row.gstRatePercent,
        tallyFormat: formatCheck.tallyFormat,
        tallyCompatible: true,
        isSac: formatCheck.isSac,
      };
    }

    // Code is well-formed but not in our DB — fall through to AI if we also
    // got a productName to ground the suggestion.
    if (event.productName) {
      const suggestion = await askGemini(event.productName, event.productSpecs);
      if (suggestion) return suggestion;
    }

    return {
      status: "INVALID",
      hsnCode: formatCheck.tallyFormat,
      description: "",
      gstRatePercent: 0,
      tallyFormat: formatCheck.tallyFormat,
      tallyCompatible: formatCheck.tallyCompatible,
      isSac: formatCheck.isSac,
      error: "HSN format OK but code not found in India GST schedule",
    };
  }

  // ---- Path 2: user gave only a productName — go straight to AI ----
  const suggestion = await askGemini(event.productName!, event.productSpecs);
  if (suggestion) return suggestion;

  return {
    status: "INVALID",
    hsnCode: "",
    description: "",
    gstRatePercent: 0,
    tallyFormat: "",
    tallyCompatible: false,
    isSac: false,
    error: "Could not resolve HSN code for given product name",
  };
};

interface HsnRow {
  hsnCode: string;
  description: string;
  gstRatePercent: number;
}

/** Primary lookup path: DynamoDB HSNDatabase table, keyed on hsnCode. */
async function lookupInDynamo(hsnCode: string): Promise<HsnRow | null> {
  try {
    const row = await getItem<HsnRow & { id?: string }>("HSNDatabase", { id: hsnCode });
    if (!row || !row.hsnCode) return null;
    return {
      hsnCode: row.hsnCode,
      description: row.description ?? "",
      gstRatePercent: Number(row.gstRatePercent ?? 0),
    };
  } catch (e) {
    console.warn("[hsn-validator] DynamoDB lookup failed:", (e as Error).message);
    return null;
  }
}

async function lookupInOpenSearch(hsnCode: string): Promise<HsnRow | null> {
  const endpoint = getOpenSearchEndpoint();
  if (!endpoint) return null;

  try {
    // IAM SigV4 signing for AOSS is handled via the sibling `_lib/opensearch.ts`
    // helper (added later). For this MVP we query via direct HTTP + an AOSS
    // data-access policy scoped to the index.
    const url = `${endpoint.replace(/\/$/, "")}/${getHsnIndex()}/_search`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        query: { term: { "hsnCode.keyword": hsnCode } },
        size: 1,
      }),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as {
      hits?: { hits?: Array<{ _source: HsnRow }> };
    };
    const hits = body.hits?.hits ?? [];
    if (!hits.length) return null;
    return hits[0]!._source;
  } catch (e) {
    console.warn("[hsn-validator] OpenSearch lookup failed:", (e as Error).message);
    return null;
  }
}

async function askGemini(
  productName: string,
  productSpecs?: string,
): Promise<Output | null> {
  try {
    const apiKey = await getSecretField(
      process.env.GEMINI_SECRET_ID ?? "av-inventory/gemini-api-key",
      "apiKey",
    );

    const prompt = buildGeminiPrompt(productName, productSpecs);
    // Gemini 2.x does NOT allow combining `tools: [{google_search: {}}]` with
    // `responseMimeType: "application/json"` — the API errors with
    // "Tool use with a response mime type: 'application/json' is unsupported".
    // We keep google_search (for CBIC grounding) and parse JSON from plain text.
    const body = {
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      tools: [{ google_search: {} }],
      generationConfig: {
        temperature: 0.1,
      },
    };

    // Model is env-configurable — default gemini-2.5-flash (fast + cheap + tool-capable).
    // Bump to gemini-2.5-pro or gemini-pro-latest for higher-quality AI suggestions.
    const model = process.env.GEMINI_MODEL ?? "gemini-2.5-flash";
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      console.warn("[hsn-validator] Gemini HTTP", res.status, await res.text());
      return null;
    }
    const data = (await res.json()) as {
      candidates?: Array<{
        content?: { parts?: Array<{ text?: string }> };
        groundingMetadata?: {
          groundingChunks?: Array<{ web?: { uri?: string; title?: string } }>;
        };
      }>;
    };
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) return null;
    const parsed = extractJson(text) as {
      hsnCode?: string;
      description?: string;
      gstRate?: number;
      source_url?: string;
    } | null;
    if (!parsed) return null;
    if (!parsed.hsnCode) return null;
    const tally = normalizeHsnForTally(parsed.hsnCode);
    const fmt = validateHsn(tally);
    const groundingUrl =
      parsed.source_url ??
      data.candidates?.[0]?.groundingMetadata?.groundingChunks?.[0]?.web?.uri;

    return {
      status: "AI_SUGGESTED",
      hsnCode: tally,
      description: parsed.description ?? productName,
      gstRatePercent: parsed.gstRate ?? 0,
      tallyFormat: tally,
      tallyCompatible: fmt.tallyCompatible,
      isSac: fmt.isSac,
      sourceUrl: groundingUrl,
      sourceDomain: groundingUrl ? safeDomain(groundingUrl) : undefined,
    };
  } catch (e) {
    console.warn("[hsn-validator] Gemini call failed:", (e as Error).message);
    return null;
  }
}

function buildGeminiPrompt(productName: string, specs?: string): string {
  return [
    "Find the correct HSN code under India's GST Tariff Schedule for the following product.",
    `Product name: ${productName}`,
    specs ? `Specifications: ${specs}` : "",
    "Return ONLY a JSON object with this shape (no prose, no markdown):",
    `{"hsnCode": "8-digit code", "description": "short CBIC description", "gstRate": 18, "source_url": "https://cbic.gov.in/..."}`,
    "Prefer the most specific 8-digit code. Cite the official CBIC or GST Council page as source_url.",
  ]
    .filter(Boolean)
    .join("\n");
}

function safeDomain(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}

/**
 * Extract a JSON object from Gemini's text reply. Handles:
 *   - Pure JSON: `{"hsnCode":"..."}`
 *   - Markdown-fenced: ` ```json\n{...}\n``` ` or ` ```\n{...}\n``` `
 *   - JSON embedded in prose (picks the first balanced { ... } object)
 * Returns `null` if no valid JSON object is found.
 */
function extractJson(text: string): unknown {
  const trimmed = text.trim();
  // Fast path: whole text is JSON.
  if (trimmed.startsWith("{")) {
    try {
      return JSON.parse(trimmed);
    } catch {
      /* fall through */
    }
  }
  // Markdown fence: ```json ... ```
  const fenceMatch = /```(?:json)?\s*([\s\S]*?)\s*```/i.exec(trimmed);
  if (fenceMatch?.[1]) {
    try {
      return JSON.parse(fenceMatch[1]);
    } catch {
      /* fall through */
    }
  }
  // Balanced-brace scan: grab the first { ... } that parses.
  const start = trimmed.indexOf("{");
  if (start >= 0) {
    let depth = 0;
    for (let i = start; i < trimmed.length; i++) {
      const ch = trimmed[i];
      if (ch === "{") depth++;
      else if (ch === "}") {
        depth--;
        if (depth === 0) {
          try {
            return JSON.parse(trimmed.slice(start, i + 1));
          } catch {
            break;
          }
        }
      }
    }
  }
  return null;
}
