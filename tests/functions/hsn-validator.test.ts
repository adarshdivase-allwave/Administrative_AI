import { describe, it, beforeEach, expect } from "../helpers/test-shim.js";
import { mockClient } from "aws-sdk-client-mock";
import { DynamoDBDocumentClient, GetCommand } from "@aws-sdk/lib-dynamodb";
import { GetSecretValueCommand, SecretsManagerClient } from "@aws-sdk/client-secrets-manager";
import { _resetClientsForTests } from "../../amplify/functions/_lib/aws-clients.js";
import { _clearSecretsCacheForTests } from "../../amplify/functions/_lib/secrets.js";
import { handler } from "../../amplify/functions/hsn-validator/handler.js";

const ddbMock = mockClient(DynamoDBDocumentClient);
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
  ddbMock.reset();
  secretsMock.reset();
  _resetClientsForTests();
  _clearSecretsCacheForTests();
  globalThis.fetch = originalFetch;
  delete process.env.OPENSEARCH_COLLECTION_ENDPOINT;
  delete process.env.USE_OPENSEARCH;
  process.env.GEMINI_SECRET_ID = "test/gemini";
});

describe("hsn-validator (DynamoDB-first)", () => {
  it("returns INVALID for malformed codes (no DB hit needed)", async () => {
    const out = await handler({ hsnCode: "85AB" });
    expect(out.status).toBe("INVALID");
    expect(out.error).toMatch(/4\/6\/8 digits/);
  });

  it("throws when neither code nor productName given", async () => {
    const err = await handler({} as never).catch((e: Error) => e.message);
    expect(err).toMatch(/required/);
  });

  it("looks up valid code in DynamoDB HSNDatabase (primary path)", async () => {
    ddbMock.on(GetCommand).resolves({
      Item: {
        id: "85287200",
        hsnCode: "85287200",
        description: "Television reception apparatus",
        gstRatePercent: 18,
      },
    });

    const out = await handler({ hsnCode: "85287200" });
    expect(out.status).toBe("VALID");
    expect(out.description).toBe("Television reception apparatus");
    expect(out.gstRatePercent).toBe(18);
    expect(out.tallyFormat).toBe("85287200");
  });

  it("normalizes whitespace before DynamoDB lookup", async () => {
    const getCalls: unknown[] = [];
    ddbMock.on(GetCommand).callsFake((input) => {
      getCalls.push(input);
      return {
        Item: {
          id: "85287200",
          hsnCode: "85287200",
          description: "x",
          gstRatePercent: 18,
        },
      };
    });

    const out = await handler({ hsnCode: " 8528 72 00 " });
    expect(out.status).toBe("VALID");
    expect(getCalls.length).toBeGreaterThanOrEqual(1);
    const firstKey = (getCalls[0] as { Key?: { id?: string } }).Key?.id;
    expect(firstKey).toBe("85287200");
  });

  it("returns INVALID (not found) when DynamoDB has no match and no productName for AI", async () => {
    ddbMock.on(GetCommand).resolves({ Item: undefined });

    const out = await handler({ hsnCode: "99999999" });
    expect(out.status).toBe("INVALID");
    expect(out.error).toMatch(/not found/);
  });

  it("falls back to Gemini when DynamoDB misses AND productName given", async () => {
    ddbMock.on(GetCommand).resolves({ Item: undefined });
    secretsMock
      .on(GetSecretValueCommand)
      .resolves({ SecretString: JSON.stringify({ apiKey: "gem-key" }) });

    recordingFetch(() => ({
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
    }));

    const out = await handler({ hsnCode: "99999999", productName: "55 inch LCD Display" });
    expect(out.status).toBe("AI_SUGGESTED");
    expect(out.hsnCode).toBe("85287200");
    expect(out.gstRatePercent).toBe(18);
    expect(out.sourceDomain).toBe("cbic.gov.in");
  });

  it("returns INVALID gracefully when Gemini fails", async () => {
    ddbMock.on(GetCommand).resolves({ Item: undefined });
    secretsMock
      .on(GetSecretValueCommand)
      .resolves({ SecretString: JSON.stringify({ apiKey: "gem-key" }) });
    recordingFetch(() => ({ ok: false, status: 500, json: { error: "nope" } }));

    const out = await handler({ productName: "Some product" });
    expect(out.status).toBe("INVALID");
    expect(out.error).toMatch(/Could not resolve/);
  });

  it("uses OpenSearch augmentation only when USE_OPENSEARCH=1 (opt-in)", async () => {
    process.env.USE_OPENSEARCH = "1";
    process.env.OPENSEARCH_COLLECTION_ENDPOINT = "https://example.aoss.amazonaws.com";

    // DynamoDB misses first
    ddbMock.on(GetCommand).resolves({ Item: undefined });

    recordingFetch(() => ({
      ok: true,
      json: {
        hits: {
          hits: [
            {
              _source: {
                hsnCode: "85287200",
                description: "OpenSearch-sourced description",
                gstRatePercent: 18,
              },
            },
          ],
        },
      },
    }));

    const out = await handler({ hsnCode: "85287200" });
    expect(out.status).toBe("VALID");
    expect(out.description).toBe("OpenSearch-sourced description");
  });
});
