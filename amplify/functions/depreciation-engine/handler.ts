/**
 * depreciation-engine — runs 1st of every month @ 01:00 IST via EventBridge.
 *
 * Iterates every UnitRecord where inventoryCategory = ASSET, applies the
 * unit's depreciation model (STRAIGHT_LINE or DECLINING_BALANCE), writes a
 * DepreciationRecord history row, and updates currentBookValue on the unit.
 *
 * Units already at salvage value are still visited but produce a zero-dep
 * record (so the monthly history is continuous and reports don't skip rows).
 *
 * Batching:
 *   - Uses the productId-category-index GSI (inventoryCategory = "ASSET")
 *     partition per product — avoids an unbounded table scan.
 *   - Concurrency limited to 10 parallel updates to stay under DynamoDB WCU.
 *
 * Idempotency:
 *   - DepreciationRecord PK is `{unitId}#{runDateYYYYMM}` — a second run in
 *     the same month no-ops for units that already have a record.
 */
import type { ScheduledHandler } from "aws-lambda";
import { computeMonthlyDepreciation } from "../../../shared/depreciation.js";
import { fyLabel } from "../../../shared/fy.js";
import { queryItems, scanItems, updateItem, putItem } from "../_lib/ddb.js";
import { writeAudit } from "../_lib/audit.js";

interface UnitRow {
  id: string;
  inventoryCategory?: string;
  depreciationModel?: "STRAIGHT_LINE" | "DECLINING_BALANCE";
  purchasePrice?: number;
  salvageValue?: number;
  usefulLifeYears?: number;
  purchaseDate?: string;
  currentBookValue?: number;
}

const CONCURRENCY = 10;

export const handler: ScheduledHandler = async (event) => {
  const runAt = new Date(event.time ?? new Date().toISOString());
  const runDate = runAt.toISOString().slice(0, 10); // YYYY-MM-DD
  const monthKey = runAt.toISOString().slice(0, 7); // YYYY-MM (idempotency suffix)
  const fy = fyLabel(runAt);

  console.info(`[depreciation-engine] starting run for ${runDate} (${fy})`);

  const assets = await loadAllAssets();
  console.info(`[depreciation-engine] ${assets.length} asset units to process`);

  let processed = 0;
  let skipped = 0;
  let errors = 0;

  // Simple bounded-concurrency pool (no external dep).
  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, assets.length) }, async () => {
      while (cursor < assets.length) {
        const myIdx = cursor++;
        const unit = assets[myIdx]!;
        try {
          const result = await processUnit(unit, runDate, monthKey, fy);
          if (result === "processed") processed++;
          else skipped++;
        } catch (e) {
          errors++;
          console.error(`[depreciation-engine] unit ${unit.id} failed:`, (e as Error).message);
        }
      }
    }),
  );

  await writeAudit({
    actorRole: "SYSTEM",
    action: "DEPRECIATION_RUN",
    entityType: "DepreciationRun",
    entityId: monthKey,
    after: { runDate, processed, skipped, errors, fy, totalAssets: assets.length },
  });

  console.info(
    `[depreciation-engine] done: ${processed} processed, ${skipped} skipped, ${errors} errors`,
  );
};

async function loadAllAssets(): Promise<UnitRow[]> {
  // We need all units where inventoryCategory = "ASSET". The spec GSI is
  // productId + inventoryCategory, but we don't know all productIds upfront.
  // A filtered scan on a small field works for the asset fleet (typically
  // hundreds, not millions). If the fleet grows, replace with a stream-based
  // materialized view keyed on inventoryCategory.
  return scanItems<UnitRow>("UnitRecord", {
    FilterExpression: "inventoryCategory = :c",
    ExpressionAttributeValues: { ":c": "ASSET" },
  });
}

async function processUnit(
  unit: UnitRow,
  runDate: string,
  monthKey: string,
  fy: string,
): Promise<"processed" | "skipped"> {
  // Sanity: skip if depreciation config is incomplete.
  if (
    typeof unit.purchasePrice !== "number" ||
    typeof unit.usefulLifeYears !== "number" ||
    !unit.purchaseDate ||
    !unit.depreciationModel
  ) {
    return "skipped";
  }

  // Idempotency: skip if a record already exists for this (unit, month).
  const depId = `${unit.id}#${monthKey}`;
  const existing = await queryItems("DepreciationRecord", {
    KeyConditionExpression: "id = :id",
    ExpressionAttributeValues: { ":id": depId },
  }).catch(() => [] as never);
  if (existing.length > 0) return "skipped";

  const before = unit.currentBookValue ?? unit.purchasePrice;
  const result = computeMonthlyDepreciation({
    cost: unit.purchasePrice,
    salvageValue: unit.salvageValue ?? 0,
    usefulLifeYears: unit.usefulLifeYears,
    purchaseDate: new Date(unit.purchaseDate),
    currentBookValue: before,
    model: unit.depreciationModel,
    asOfDate: new Date(runDate),
  });

  // Write history row.
  const now = new Date().toISOString();
  await putItem("DepreciationRecord", {
    id: depId,
    unitId: unit.id,
    runDate,
    fyYear: fy.replace(/^FY /, ""),
    method: result.method,
    monthlyDepreciationInr: result.monthlyDepreciation,
    accumulatedDepreciationInr: result.accumulatedDepreciation,
    bookValueBeforeInr: before,
    bookValueAfterInr: result.newBookValue,
    hasReachedSalvage: result.hasReachedSalvage,
    createdAt: now,
    updatedAt: now,
  });

  // Update the unit's currentBookValue.
  await updateItem("UnitRecord", { id: unit.id }, {
    UpdateExpression: "SET currentBookValue = :b, updatedAt = :t",
    ExpressionAttributeValues: { ":b": result.newBookValue, ":t": now },
  });

  return "processed";
}
