import { describe, it, beforeEach, expect } from "../helpers/test-shim.js";
import { mockClient } from "aws-sdk-client-mock";
import {
  DynamoDBDocumentClient,
  ScanCommand,
  PutCommand,
} from "@aws-sdk/lib-dynamodb";
import { _resetClientsForTests } from "../../amplify/functions/_lib/aws-clients.js";
import { handler } from "../../amplify/functions/fy-rollover/handler.js";
import type { EventBridgeEvent } from "aws-lambda";

const ddb = mockClient(DynamoDBDocumentClient);

function evt(time: string): EventBridgeEvent<"Scheduled Event", unknown> {
  return {
    version: "0",
    id: "x",
    "detail-type": "Scheduled Event",
    source: "aws.events",
    account: "123",
    time,
    region: "ap-south-1",
    resources: [],
    detail: {},
  };
}

// Helper: Apr 1 00:01 IST = Mar 31 18:31 UTC
const APR1_2026_IST = "2026-03-31T18:31:00Z"; // = Apr 1, 00:01 IST

beforeEach(() => {
  ddb.reset();
  _resetClientsForTests();
});

describe("fy-rollover", () => {
  it("creates new-FY counters for every existing prev-FY counter", async () => {
    ddb.on(ScanCommand).resolves({
      Items: [
        {
          counterKey: "INVOICE#INV#2526",
          fyYear: "2526",
          prefix: "INV",
          documentKind: "INVOICE",
          lastSequence: 4821,
        },
        {
          counterKey: "DC#DC#2526",
          fyYear: "2526",
          prefix: "DC",
          documentKind: "DC",
          lastSequence: 1123,
        },
      ],
    });
    ddb.on(PutCommand).resolves({});

    await handler(evt(APR1_2026_IST), {} as never, () => {});

    // Expected puts:
    //   - INVOICE#INV#2627 (from existing INV counter)
    //   - DC#DC#2627 (from existing DC counter)
    //   - GRN#GRN#2627 (default seed)
    //   - PO#PO#2627 (default seed)
    //   - 1 AuditLog row
    // = 5 total
    const puts = ddb.commandCalls(PutCommand);
    expect(puts.length).toBe(5);

    const bodies = puts.map((c) => c.args[0].input.Item as Record<string, unknown>);
    const keys = bodies.map((b) => b.counterKey).filter(Boolean);
    expect(keys).toContain("INVOICE#INV#2627");
    expect(keys).toContain("DC#DC#2627");
    expect(keys).toContain("GRN#GRN#2627");
    expect(keys).toContain("PO#PO#2627");

    // All new counter rows have lastSequence = 0.
    for (const b of bodies) {
      if (typeof b.counterKey === "string" && b.counterKey !== undefined) {
        if (b.lastSequence !== undefined) {
          expect(b.lastSequence).toBe(0);
        }
      }
    }
  });

  it("is idempotent: does not duplicate counters that already exist for the new FY", async () => {
    ddb.on(ScanCommand).resolves({
      Items: [
        {
          counterKey: "INVOICE#INV#2526",
          fyYear: "2526",
          prefix: "INV",
          documentKind: "INVOICE",
          lastSequence: 100,
        },
        {
          // already-created new-FY row
          counterKey: "INVOICE#INV#2627",
          fyYear: "2627",
          prefix: "INV",
          documentKind: "INVOICE",
          lastSequence: 3,
        },
      ],
    });
    ddb.on(PutCommand).resolves({});

    await handler(evt(APR1_2026_IST), {} as never, () => {});

    const puts = ddb.commandCalls(PutCommand);
    const keys = puts.map((c) => (c.args[0].input.Item as Record<string, unknown>).counterKey);
    // Should NOT have issued a put for INVOICE#INV#2627 (already existed).
    // Should have issued puts for the 3 default seeds + 1 audit = 4.
    expect(keys).not.toContain("INVOICE#INV#2627");
    expect(puts.length).toBe(4);
  });

  it("tolerates a racing ConditionalCheckFailedException", async () => {
    ddb.on(ScanCommand).resolves({
      Items: [
        {
          counterKey: "INVOICE#INV#2526",
          fyYear: "2526",
          prefix: "INV",
          documentKind: "INVOICE",
          lastSequence: 10,
        },
      ],
    });
    // Simulate race: first put (the new INV counter) fails with CCFE.
    let putCount = 0;
    ddb.on(PutCommand).callsFake(() => {
      putCount++;
      if (putCount === 1) {
        const err = new Error("conditional failed") as Error & { name: string };
        err.name = "ConditionalCheckFailedException";
        throw err;
      }
      return {};
    });

    await handler(evt(APR1_2026_IST), {} as never, () => {});

    // Handler should not throw.
    expect(putCount).toBeGreaterThanOrEqual(1);
  });

  it("runs and logs when invoked on a non-April-1 date", async () => {
    ddb.on(ScanCommand).resolves({ Items: [] });
    ddb.on(PutCommand).resolves({});

    // June 15 IST = June 15 at 06:30 UTC
    await handler(evt("2025-06-15T06:30:00Z"), {} as never, () => {});

    // Seeded 4 default counters + 1 audit.
    expect(ddb.commandCalls(PutCommand).length).toBe(5);
  });
});
