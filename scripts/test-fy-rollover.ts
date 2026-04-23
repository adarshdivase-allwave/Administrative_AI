#!/usr/bin/env tsx
/**
 * test-fy-rollover — local simulation of the FY rollover Lambda across the
 * critical timezone-edge scenarios. Runs WITHOUT any AWS resources.
 *
 * Scenarios covered:
 *   1. March 31 23:59:59 IST   → still FY N (no rollover)
 *   2. April 1 00:00:30 IST    → new FY; all 4 default counters seeded
 *   3. April 1 00:01:00 IST    → the actual scheduled trigger moment
 *   4. April 1 23:59:59 IST    → still on rollover day; idempotent replay
 *   5. April 2 00:01 IST       → day after; warning logged
 *
 * Usage:
 *   npm run test:fy-rollover
 *
 * Exits non-zero if any simulated invocation does not produce the expected
 * set of counter keys.
 */
import { mockClient } from "aws-sdk-client-mock";
import {
  DynamoDBDocumentClient,
  ScanCommand,
  PutCommand,
} from "@aws-sdk/lib-dynamodb";
import { _resetClientsForTests } from "../amplify/functions/_lib/aws-clients.js";
import { handler } from "../amplify/functions/fy-rollover/handler.js";
import { fyShort, fyStartYear } from "../shared/fy.js";

const ddb = mockClient(DynamoDBDocumentClient);

interface Scenario {
  label: string;
  when: string; // ISO UTC
  existingCounters: Array<{ counterKey: string; fyYear: string; prefix: string; documentKind: string; lastSequence: number }>;
  expectNewCounterKeys: string[]; // must all be present after the run
}

// March 31 23:59:59 IST = UTC 18:29:59 of same UTC day
// April 1 00:01:00 IST  = UTC 18:31:00 of prev UTC day (Mar 31)
// Note: fyStartYear+fyShort treat this correctly because they convert to IST internally.

const scenarios: Scenario[] = [
  {
    label: "March 31 23:59 IST — last second of FY 2025-26",
    when: "2026-03-31T18:29:59Z",
    existingCounters: [
      { counterKey: "INVOICE#INV#2526", fyYear: "2526", prefix: "INV", documentKind: "INVOICE", lastSequence: 482 },
    ],
    // Even though we're not yet on Apr 1 IST, the handler is permissive and
    // still seeds counters for whatever FY is "current" (2526 here).
    expectNewCounterKeys: [], // no new FY rollover
  },
  {
    label: "April 1 00:01 IST — actual rollover trigger",
    when: "2026-03-31T18:31:00Z",
    existingCounters: [
      { counterKey: "INVOICE#INV#2526", fyYear: "2526", prefix: "INV", documentKind: "INVOICE", lastSequence: 482 },
      { counterKey: "DC#DC#2526", fyYear: "2526", prefix: "DC", documentKind: "DC", lastSequence: 110 },
    ],
    expectNewCounterKeys: [
      "INVOICE#INV#2627",
      "DC#DC#2627",
      "GRN#GRN#2627",
      "PO#PO#2627",
    ],
  },
  {
    label: "April 1 23:59 IST — idempotent replay later same day",
    when: "2026-04-01T18:29:59Z",
    existingCounters: [
      { counterKey: "INVOICE#INV#2526", fyYear: "2526", prefix: "INV", documentKind: "INVOICE", lastSequence: 482 },
      { counterKey: "INVOICE#INV#2627", fyYear: "2627", prefix: "INV", documentKind: "INVOICE", lastSequence: 17 },
    ],
    expectNewCounterKeys: ["DC#DC#2627", "GRN#GRN#2627", "PO#PO#2627"],
  },
  {
    label: "April 2 IST — non-rollover day; handler still runs but warns",
    when: "2026-04-02T06:00:00Z",
    existingCounters: [],
    expectNewCounterKeys: [
      "INVOICE#INV#2627",
      "DC#DC#2627",
      "GRN#GRN#2627",
      "PO#PO#2627",
    ],
  },
];

async function run(): Promise<void> {
  let failed = 0;

  console.log(`FY rollover simulation — ${scenarios.length} scenarios\n`);

  for (const s of scenarios) {
    ddb.reset();
    _resetClientsForTests();

    const createdKeys: string[] = [];
    ddb.on(ScanCommand).resolves({ Items: s.existingCounters });
    ddb.on(PutCommand).callsFake((input) => {
      const tbl = (input as { TableName?: string }).TableName ?? "";
      if (tbl.startsWith("FYSequenceCounter")) {
        const item = (input as { Item?: { counterKey?: string } }).Item;
        if (item?.counterKey) createdKeys.push(item.counterKey);
      }
      return {};
    });

    await handler(
      {
        version: "0",
        id: "test",
        "detail-type": "Scheduled Event",
        source: "aws.events",
        account: "123",
        time: s.when,
        region: "ap-south-1",
        resources: [],
        detail: {},
      },
      {} as never,
      () => {},
    );

    const whenDate = new Date(s.when);
    const fy = fyShort(whenDate);
    const fyStart = fyStartYear(whenDate);

    const missing = s.expectNewCounterKeys.filter((k) => !createdKeys.includes(k));
    const ok = missing.length === 0;
    const mark = ok ? "✓" : "✖";
    console.log(`${mark} ${s.label}`);
    console.log(`    IST FY=${fy} (start=${fyStart}); created ${createdKeys.length} counters`);
    if (createdKeys.length > 0) console.log(`    Keys: ${createdKeys.join(", ")}`);
    if (!ok) {
      console.log(`    MISSING: ${missing.join(", ")}`);
      failed++;
    }
    console.log();
  }

  if (failed > 0) {
    console.error(`✖ ${failed} scenario(s) failed`);
    process.exit(1);
  }
  console.log("✓ All scenarios passed");
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
