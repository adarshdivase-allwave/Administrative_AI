import { describe, it, beforeEach, expect } from "../helpers/test-shim.js";
import { mockClient } from "aws-sdk-client-mock";
import { DynamoDBDocumentClient, ScanCommand, QueryCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import { GetSecretValueCommand, SecretsManagerClient } from "@aws-sdk/client-secrets-manager";
import { _resetClientsForTests } from "../../amplify/functions/_lib/aws-clients.js";
import { _clearSecretsCacheForTests } from "../../amplify/functions/_lib/secrets.js";
import { handler } from "../../amplify/functions/forex-rate-fetcher/handler.js";

const ddbMock = mockClient(DynamoDBDocumentClient);
const secretsMock = mockClient(SecretsManagerClient);

// Stub global fetch — each test replaces this.
const originalFetch = globalThis.fetch;
function stubFetch(response: unknown, ok = true, status = 200): void {
  globalThis.fetch = (async () => ({
    ok,
    status,
    json: async () => response,
    text: async () => JSON.stringify(response),
  })) as unknown as typeof fetch;
}

beforeEach(() => {
  ddbMock.reset();
  secretsMock.reset();
  _resetClientsForTests();
  _clearSecretsCacheForTests();
  globalThis.fetch = originalFetch;
  // Force the default keyless path — no secret env var needed.
  delete process.env.EXCHANGE_RATE_SECRET_ID;
  process.env.AWS_REGION = "ap-south-1";
});

describe("forex-rate-fetcher", () => {
  it("returns cached rate when fresh", async () => {
    ddbMock.on(QueryCommand).rejects(new Error("no GSI")); // force scan fallback
    ddbMock.on(ScanCommand).resolves({
      Items: [
        {
          id: "x",
          baseCurrency: "INR",
          quoteCurrency: "USD",
          rate: 83.5,
          fetchedAt: "2026-04-23T00:00:00Z",
          expiresAt: new Date(Date.now() + 3600_000).toISOString(),
        },
      ],
    });

    const out = await handler({ quoteCurrency: "USD" });

    expect(out.cacheHit).toBe(true);
    expect(out.rate).toBe(83.5);
    expect(out.source).toBe("cache");
    expect(secretsMock.calls().length).toBe(0); // no API fetch
  });

  it("fetches live rate on cache miss and stores it", async () => {
    ddbMock.on(QueryCommand).rejects(new Error("no GSI"));
    ddbMock.on(ScanCommand).resolves({ Items: [] });
    ddbMock.on(PutCommand).resolves({});

    // open.er-api.com response shape: { result, rates: { INR, ... } }
    stubFetch({ result: "success", rates: { INR: 84.12 } });

    const out = await handler({ quoteCurrency: "EUR" });

    expect(out.cacheHit).toBe(false);
    expect(out.source).toBe("open.er-api.com");
    expect(out.rate).toBe(84.12);
    expect(ddbMock.commandCalls(PutCommand).length).toBe(1);
  });

  it("bypasses cache with forceRefresh", async () => {
    ddbMock.on(ScanCommand).resolves({
      Items: [
        {
          id: "x",
          baseCurrency: "INR",
          quoteCurrency: "USD",
          rate: 83.5,
          fetchedAt: new Date().toISOString(),
          expiresAt: new Date(Date.now() + 3600_000).toISOString(),
        },
      ],
    });
    ddbMock.on(QueryCommand).rejects(new Error("no GSI"));
    ddbMock.on(PutCommand).resolves({});
    stubFetch({ result: "success", rates: { INR: 84.0 } });

    const out = await handler({ quoteCurrency: "USD", forceRefresh: true });
    expect(out.cacheHit).toBe(false);
    expect(out.rate).toBe(84.0);
  });

  it("rejects INR as quote currency", async () => {
    const err = await handler({ quoteCurrency: "INR" as never }).catch((e: Error) => e.message);
    expect(err).toMatch(/INR/);
  });

  it("rejects unsupported currency", async () => {
    const err = await handler({ quoteCurrency: "JPY" as never }).catch((e: Error) => e.message);
    expect(err).toMatch(/Unsupported/);
  });

  it("rejects implausible API responses", async () => {
    ddbMock.on(ScanCommand).resolves({ Items: [] });
    ddbMock.on(QueryCommand).rejects(new Error("no GSI"));
    stubFetch({ result: "success", rates: { INR: 9999 } });

    const err = await handler({ quoteCurrency: "GBP" }).catch((e: Error) => e.message);
    expect(err).toMatch(/implausible/i);
  });

  it("surfaces API error envelopes", async () => {
    ddbMock.on(ScanCommand).resolves({ Items: [] });
    ddbMock.on(QueryCommand).rejects(new Error("no GSI"));
    stubFetch({ result: "error", "error-type": "invalid-key" });

    const err = await handler({ quoteCurrency: "USD" }).catch((e: Error) => e.message);
    expect(err).toMatch(/invalid-key/);
  });
});
