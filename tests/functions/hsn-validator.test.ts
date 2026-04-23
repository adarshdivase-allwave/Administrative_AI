import { describe, it, beforeEach, expect } from "../helpers/test-shim.js";
import { mockClient } from "aws-sdk-client-mock";
import { GetSecretValueCommand, SecretsManagerClient } from "@aws-sdk/client-secrets-manager";
import { _resetClientsForTests } from "../../amplify/functions/_lib/aws-clients.js";
import { _clearSecretsCacheForTests } from "../../amplify/functions/_lib/secrets.js";
import { handler } from "../../amplify/functions/hsn-validator/handler.js";

const secretsMock = mockClient(SecretsManagerClient);

const originalFetch = globalThis.fetch;

type FetchRecorder = {
  calls: Array<{ url: string; body: string }>;
  reset(): void;
};

function recordingFetch(
  responder: (url: string) => { ok: boolean; status?: number; json: unknown },
): FetchRecorder {
  const rec: FetchRecorder = {
    calls: [],
    reset() {
      this.calls = [];
    },
  };
  globalThis.fetch = (async (input: unknown, init?: { body?: unknown }) => {
    const url = String(input);
    rec.calls.push({ url, body: String(init?.body ?? "") });
    const r = responder(url);
    return {
      ok: r.ok,
      status: r.status ?? (r.ok ? 200 : 500),
      json: async () => r.json,
      text: async () => JSON.stringify(r.json),
    };
  }) as unknown as typeof fetch;
  return rec;
}

beforeEach(() => {
  secretsMock.reset();
  _resetClientsForTests();
  _clearSecretsCacheForTests();
  globalThis.fetch = originalFetch;
  delete process.env.OPENSEARCH_COLLECTION_ENDPOINT;
  process.env.GEMINI_SECRET_ID = "test/gemini";
});

describe("hsn-validator", () => {
  it("returns INVALID for malformed codes", async () => {
    const out = await handler({ hsnCode: "85AB" });
    expect(out.status).toBe("INVALID");
    expect(out.error).toMatch(/4\/6\/8 digits/);
  });

  it("throws when neither code nor productName given", async () => {
    const err = await handler({} as never).catch((e: Error) => e.message);
    expect(err).toMatch(/required/);
  });

  it("looks up valid code in OpenSearch when configured", async () => {
    process.env.OPENSEARCH_COLLECTION_ENDPOINT = "https://example.aoss.amazonaws.com";
    recordingFetch(() => ({
      ok: true,
      json: {
        hits: {
          hits: [
            {
              _source: {
                hsnCode: "85287200",
                description: "Television reception apparatus",
                gstRatePercent: 18,
              },
            },
          ],
        },
      },
    }));

    const out = await handler({ hsnCode: "85287200" });
    expect(out.status).toBe("VALID");
    expect(out.description).toBe("Television reception apparatus");
    expect(out.gstRatePercent).toBe(18);
    expect(out.tallyFormat).toBe("85287200");
  });

  it("normalizes whitespace before lookup", async () => {
    process.env.OPENSEARCH_COLLECTION_ENDPOINT = "https://example.aoss.amazonaws.com";
    const rec = recordingFetch(() => ({
      ok: true,
      json: { hits: { hits: [{ _source: { hsnCode: "85287200", description: "x", gstRatePercent: 18 } }] } },
    }));

    await handler({ hsnCode: " 8528 72 00 " });
    expect(rec.calls[0]!.body).toContain("85287200");
  });

  it("returns INVALID (not found) when OpenSearch has no match and no productName for AI", async () => {
    process.env.OPENSEARCH_COLLECTION_ENDPOINT = "https://example.aoss.amazonaws.com";
    recordingFetch(() => ({ ok: true, json: { hits: { hits: [] } } }));

    const out = await handler({ hsnCode: "99999999" });
    expect(out.status).toBe("INVALID");
    expect(out.error).toMatch(/not found/);
  });

  it("falls back to Gemini when OpenSearch misses AND productName given", async () => {
    process.env.OPENSEARCH_COLLECTION_ENDPOINT = "https://example.aoss.amazonaws.com";
    secretsMock
      .on(GetSecretValueCommand)
      .resolves({ SecretString: JSON.stringify({ apiKey: "gem-key" }) });

    recordingFetch((url) => {
      if (url.includes("aoss")) return { ok: true, json: { hits: { hits: [] } } };
      // Gemini
      return {
        ok: true,
        json: {
          candidates: [
            {
              content: {
                parts: [
                  {
                    text: JSON.stringify({
                      hsnCode: "85287200",
                      description: "LCD Display",
                      gstRate: 18,
                      source_url: "https://cbic.gov.in/gst-rates",
                    }),
                  },
                ],
              },
              groundingMetadata: {
                groundingChunks: [{ web: { uri: "https://cbic.gov.in/gst-rates" } }],
              },
            },
          ],
        },
      };
    });

    const out = await handler({ hsnCode: "99999999", productName: "55 inch LCD Display" });
    expect(out.status).toBe("AI_SUGGESTED");
    expect(out.hsnCode).toBe("85287200");
    expect(out.gstRatePercent).toBe(18);
    expect(out.sourceDomain).toBe("cbic.gov.in");
  });

  it("returns INVALID gracefully when Gemini fails", async () => {
    secretsMock
      .on(GetSecretValueCommand)
      .resolves({ SecretString: JSON.stringify({ apiKey: "gem-key" }) });
    recordingFetch(() => ({ ok: false, status: 500, json: { error: "nope" } }));

    const out = await handler({ productName: "Some product" });
    expect(out.status).toBe("INVALID");
    expect(out.error).toMatch(/Could not resolve/);
  });
});
