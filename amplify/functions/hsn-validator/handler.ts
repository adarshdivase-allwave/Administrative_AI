/**
 * hsn-validator — resolves a product/HSN combination against India's GST
 * HSN/SAC schedule, with AI fallback.
 *
 * Pipeline:
 *   1. Format check via shared/hsn.ts (4/6/8-digit HSN, 6-digit 99-prefix SAC)
 *   2. OpenSearch lookup in `hsn-india-gst` index
 *   3. If miss: Gemini 1.5 Pro with Google Search grounding → returns suggested code
 *
 * Input (AppSync resolver):
 *   { hsnCode?: string, productName?: string, productSpecs?: string }
 * At least one of hsnCode OR productName must be provided.
 *
 * Output:
 *   {
 *     status: "VALID" | "INVALID" | "AI_SUGGESTED",
 *     hsnCode: string,
 *     description: string,
 *     gstRatePercent: number,
 *     tallyFormat: string,
 *     tallyCompatible: boolean,
 *     isSac: boolean,
 *     sourceUrl?: string,        // only when AI_SUGGESTED
 *     sourceDomain?: string,     // ditto
 *     error?: string
 *   }
 *
 * Note: OpenSearch client + Gemini SDK are imported dynamically to keep
 * cold-start small for callers that hit cache-only paths.
 */
import { validateHsn, normalizeHsnForTally } from "../../../shared/hsn.js";
import { getSecretField } from "../_lib/secrets.js";

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

// Env vars are read lazily inside each call so that tests (which set them
// in `beforeEach`) see the latest values even though the module was loaded
// at the top of the test file.
const getOpenSearchEndpoint = () => process.env.OPENSEARCH_COLLECTION_ENDPOINT ?? "";
const getHsnIndex = () => process.env.OPENSEARCH_HSN_INDEX ?? "hsn-india-gst";

export const handler = async (event: Input): Promise<Output> => {
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
    const body = {
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      tools: [{ google_search: {} }],
      generationConfig: {
        responseMimeType: "application/json",
        temperature: 0.1,
      },
    };

    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-pro:generateContent?key=${apiKey}`;
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
    const parsed = JSON.parse(text) as {
      hsnCode?: string;
      description?: string;
      gstRate?: number;
      source_url?: string;
    };
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
