/**
 * fy-rollover — runs on April 1 @ 00:01 IST via EventBridge.
 *
 * India's FY starts April 1. On that day, ALL document sequence counters
 * (invoice, DC, GRN, PO) must reset to 0 so that the next document issued
 * is [PREFIX]-[NEW-FY]-00001 per GST Rule 46.
 *
 * Strategy:
 *   1. Read all existing FYSequenceCounter rows.
 *   2. For each row whose fyYear is the OLD FY, create a paired row for the
 *      NEW FY with lastSequence = 0. Old rows stay untouched (they remain the
 *      source of truth for documents dated in the old FY, which GST allows
 *      to be re-issued up to 3 years later).
 *   3. Idempotent: if a row for the new FY already exists (manual early
 *      creation, or a previous run today), leave it alone.
 *   4. Write one summary AuditLog entry.
 *
 * Rollover runs in IST (Asia/Kolkata) — our shared/fy.ts functions all use
 * IST, so "today is April 1" means the IST April 1 window.
 */
import type { ScheduledHandler } from "aws-lambda";
import { fyShort, fyStartYear, isFyRolloverDay } from "../../../shared/fy.js";
import { scanItems, putItem } from "../_lib/ddb.js";
import { writeAudit } from "../_lib/audit.js";

interface CounterRow {
  id?: string;
  counterKey: string;       // "INVOICE#INV#2526"
  fyYear: string;           // "2526"
  prefix?: string;
  documentKind?: "INVOICE" | "DC" | "GRN" | "PO";
  lastSequence?: number;
  lastAllocatedAt?: string;
}

export const handler: ScheduledHandler = async (event) => {
  const runAt = new Date(event.time ?? new Date().toISOString());

  // Defensive guard — EventBridge is scheduled for Apr 1 @ 00:01 IST but a
  // manual test invoke could come on any day. Allow manual invokes but log
  // the actual run day so audit shows what happened.
  if (!isFyRolloverDay(runAt)) {
    console.warn(
      `[fy-rollover] Invoked on non-FY-rollover day (${runAt.toISOString()}) — proceeding anyway. ` +
        `If unintentional, check the EventBridge schedule cron expression.`,
    );
  }

  const newFyStartYear = fyStartYear(runAt);
  const newFyShort = fyShort(runAt);
  const prevFyShort = previousFyShort(newFyStartYear);

  console.info(
    `[fy-rollover] starting: transitioning from FY ${prevFyShort} → ${newFyShort} at ${runAt.toISOString()}`,
  );

  const existing = await scanItems<CounterRow>("FYSequenceCounter");
  // Track seen keys so we skip duplicates both from scanned rows and from
  // new rows we create mid-run (avoids a second put + avoids CCFE noise).
  const seenKeys = new Set(existing.map((r) => r.counterKey));

  let created = 0;
  let skipped = 0;

  for (const row of existing) {
    if (row.fyYear !== prevFyShort) continue;
    if (!row.documentKind || !row.prefix) continue;

    const newKey = `${row.documentKind}#${row.prefix}#${newFyShort}`;
    if (seenKeys.has(newKey)) {
      skipped++;
      continue;
    }
    seenKeys.add(newKey);
    await putItem(
      "FYSequenceCounter",
      {
        id: newKey,
        counterKey: newKey,
        fyYear: newFyShort,
        prefix: row.prefix,
        documentKind: row.documentKind,
        lastSequence: 0,
        lastAllocatedAt: undefined,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      {
        // Conditional write — don't overwrite if a row was created in the
        // split-second window between our scan and our put.
        conditionExpression: "attribute_not_exists(#k)",
        expressionAttributeNames: { "#k": "counterKey" },
      },
    ).catch((e) => {
      // A ConditionalCheckFailedException means the row appeared between our
      // scan and put — treat as "already created" and move on.
      if ((e as { name?: string }).name === "ConditionalCheckFailedException") {
        skipped++;
        return;
      }
      throw e;
    });
    created++;
  }

  // Seed defaults for the standard 4 prefixes if they aren't there at all
  // (first-ever run, or fresh environment with no invoices yet).
  const standardPrefixes: Array<{ kind: CounterRow["documentKind"]; prefix: string }> = [
    { kind: "INVOICE", prefix: process.env.FY_INVOICE_PREFIX ?? "INV" },
    { kind: "DC", prefix: process.env.FY_DC_PREFIX ?? "DC" },
    { kind: "GRN", prefix: process.env.FY_GRN_PREFIX ?? "GRN" },
    { kind: "PO", prefix: process.env.FY_PO_PREFIX ?? "PO" },
  ];
  for (const { kind, prefix } of standardPrefixes) {
    const key = `${kind}#${prefix}#${newFyShort}`;
    if (seenKeys.has(key)) continue;
    seenKeys.add(key);
    await putItem(
      "FYSequenceCounter",
      {
        id: key,
        counterKey: key,
        fyYear: newFyShort,
        prefix,
        documentKind: kind,
        lastSequence: 0,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      {
        conditionExpression: "attribute_not_exists(#k)",
        expressionAttributeNames: { "#k": "counterKey" },
      },
    ).catch((e) => {
      if ((e as { name?: string }).name === "ConditionalCheckFailedException") return;
      throw e;
    });
    created++;
  }

  await writeAudit({
    actorRole: "SYSTEM",
    action: "FY_ROLLOVER",
    entityType: "FYSequenceCounter",
    entityId: newFyShort,
    after: {
      fromFy: prevFyShort,
      toFy: newFyShort,
      countersCreated: created,
      countersSkipped: skipped,
      runAt: runAt.toISOString(),
    },
  });

  console.info(
    `[fy-rollover] done: created=${created} skipped=${skipped} new FY=${newFyShort}`,
  );
};

function previousFyShort(newFyStartYear: number): string {
  const prev = newFyStartYear - 1;
  const startShort = prev % 100;
  const endShort = (prev + 1) % 100;
  return `${String(startShort).padStart(2, "0")}${String(endShort).padStart(2, "0")}`;
}
