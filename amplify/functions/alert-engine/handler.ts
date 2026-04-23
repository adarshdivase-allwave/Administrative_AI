/**
 * alert-engine — daily 9 AM IST batch scan.
 *
 * Produces StockAlert rows for the dashboard subscription feed and sends
 * a summarized SES digest to Admin for critical issues. Detects:
 *
 *   - OUT_OF_STOCK: productId-status GSI bucket count = 0 for IN_STOCK
 *   - LOW_STOCK:    count <= ProductMaster.lowStockThreshold
 *   - OVERDUE_RETURN: UnitRecord where currentDemoId != null AND
 *                     DemoRecord.expectedReturnDate < today
 *   - OVERDUE_TRANSIT: TransferOrder status = IN_TRANSIT older than 7 days
 *   - WARRANTY_EXPIRING_90 / _30 / EXPIRED (GSI: warrantyExpiryDate)
 *   - AMC_EXPIRING_45 / AMC_EXPIRED (AMCContract.endDate)
 *   - PO_OVERDUE: PurchaseOrder.expectedDeliveryDate passed, status still
 *                 in SENT_TO_VENDOR or PARTIALLY_RECEIVED
 *
 * Alert rows older than 24h with isActive="TRUE" are refreshed: we DON'T
 * create duplicates — each (alertType, productId|unitId|projectId) tuple
 * is unique per run via a deterministic-id scheme `{TYPE}#{YYYY-MM-DD}#{key}`.
 */
import type { ScheduledHandler } from "aws-lambda";
import { scanItems, getItem, putItem } from "../_lib/ddb.js";
import { writeAudit } from "../_lib/audit.js";
import { daysBetween } from "../../../shared/fy.js";

interface UnitRow {
  id: string;
  productId?: string;
  status?: string;
  inventoryCategory?: string;
  warrantyExpiryDate?: string;
  currentDemoId?: string;
  godownId?: string;
}
interface ProductRow {
  id: string;
  productName?: string;
  lowStockThreshold?: number;
  importRequired?: boolean;
}
interface DemoRow {
  id: string;
  expectedReturnDate?: string;
  clientId?: string;
  status?: string;
}
interface TransferRow {
  id: string;
  dispatchedAt?: string;
  status?: string;
}
interface AmcRow {
  id: string;
  endDate?: string;
  contractNumber?: string;
  status?: string;
}
interface PoRow {
  id: string;
  poNumber?: string;
  expectedDeliveryDate?: string;
  status?: string;
}

export const handler: ScheduledHandler = async () => {
  const today = new Date();
  const todayStr = today.toISOString().slice(0, 10);
  const counts: Record<string, number> = {};

  const incr = (k: string) => {
    counts[k] = (counts[k] ?? 0) + 1;
  };

  // ---- 1. Stock counts (OUT_OF_STOCK / LOW_STOCK) ----
  // Load all products + all GENERAL_STOCK units; bucket units by productId,
  // compare counts against thresholds.
  const [products, units] = await Promise.all([
    scanItems<ProductRow>("ProductMaster"),
    scanItems<UnitRow>("UnitRecord", {
      FilterExpression: "inventoryCategory = :c AND #s = :s",
      ExpressionAttributeNames: { "#s": "status" },
      ExpressionAttributeValues: { ":c": "GENERAL_STOCK", ":s": "IN_STOCK" },
    }),
  ]);

  const countsByProduct = units.reduce<Record<string, number>>((acc, u) => {
    if (u.productId) acc[u.productId] = (acc[u.productId] ?? 0) + 1;
    return acc;
  }, {});

  for (const p of products) {
    const count = countsByProduct[p.id] ?? 0;
    const threshold = p.lowStockThreshold ?? 0;
    if (count === 0) {
      await upsertAlert({
        type: "OUT_OF_STOCK",
        key: p.id,
        productId: p.id,
        severity: "CRITICAL",
        message: `"${p.productName}" is out of stock (GENERAL_STOCK count = 0)`,
        dayKey: todayStr,
      });
      incr("OUT_OF_STOCK");
    } else if (count <= threshold) {
      await upsertAlert({
        type: "LOW_STOCK",
        key: p.id,
        productId: p.id,
        severity: "WARNING",
        message: `"${p.productName}" is low on stock (${count} <= threshold ${threshold})`,
        dayKey: todayStr,
      });
      incr("LOW_STOCK");
      if (p.importRequired) {
        await upsertAlert({
          type: "IMPORT_NEEDED",
          key: p.id,
          productId: p.id,
          severity: "WARNING",
          message: `"${p.productName}" is low on stock and is an imported item`,
          dayKey: todayStr,
        });
        incr("IMPORT_NEEDED");
      }
    }
  }

  // ---- 2. Warranty expiry (90/30/expired) ----
  for (const u of units) {
    if (!u.warrantyExpiryDate) continue;
    const days = daysBetween(today, new Date(u.warrantyExpiryDate));
    if (days < 0) {
      await upsertAlert({
        type: "WARRANTY_EXPIRED",
        key: u.id,
        unitId: u.id,
        severity: "WARNING",
        message: `Unit ${u.id} warranty expired ${-days}d ago`,
        dayKey: todayStr,
      });
      incr("WARRANTY_EXPIRED");
    } else if (days <= 30) {
      await upsertAlert({
        type: "WARRANTY_EXPIRING_30",
        key: u.id,
        unitId: u.id,
        severity: "WARNING",
        message: `Unit ${u.id} warranty expires in ${days}d`,
        dayKey: todayStr,
      });
      incr("WARRANTY_EXPIRING_30");
    } else if (days <= 90) {
      await upsertAlert({
        type: "WARRANTY_EXPIRING_90",
        key: u.id,
        unitId: u.id,
        severity: "INFO",
        message: `Unit ${u.id} warranty expires in ${days}d`,
        dayKey: todayStr,
      });
      incr("WARRANTY_EXPIRING_90");
    }
  }

  // ---- 3. Overdue demo returns ----
  const demos = await scanItems<DemoRow>("DemoRecord", {
    FilterExpression: "#s IN (:s1, :s2)",
    ExpressionAttributeNames: { "#s": "status" },
    ExpressionAttributeValues: { ":s1": "SCHEDULED", ":s2": "IN_PROGRESS" },
  });
  for (const d of demos) {
    if (!d.expectedReturnDate) continue;
    const days = daysBetween(today, new Date(d.expectedReturnDate));
    if (days >= 0) continue;
    await upsertAlert({
      type: "OVERDUE_RETURN",
      key: d.id,
      severity: "WARNING",
      message: `Demo ${d.id} overdue by ${-days}d`,
      dayKey: todayStr,
    });
    incr("OVERDUE_RETURN");
  }

  // ---- 4. Overdue transit (> 7 days) ----
  const transits = await scanItems<TransferRow>("TransferOrder", {
    FilterExpression: "#s = :s",
    ExpressionAttributeNames: { "#s": "status" },
    ExpressionAttributeValues: { ":s": "IN_TRANSIT" },
  });
  for (const t of transits) {
    if (!t.dispatchedAt) continue;
    const daysInTransit = daysBetween(new Date(t.dispatchedAt), today);
    if (daysInTransit < 7) continue;
    await upsertAlert({
      type: "OVERDUE_TRANSIT",
      key: t.id,
      severity: "WARNING",
      message: `Transfer ${t.id} in transit for ${daysInTransit}d`,
      dayKey: todayStr,
    });
    incr("OVERDUE_TRANSIT");
  }

  // ---- 5. AMC expiring ----
  const amcs = await scanItems<AmcRow>("AMCContract", {
    FilterExpression: "#s = :s",
    ExpressionAttributeNames: { "#s": "status" },
    ExpressionAttributeValues: { ":s": "ACTIVE" },
  });
  for (const a of amcs) {
    if (!a.endDate) continue;
    const days = daysBetween(today, new Date(a.endDate));
    if (days < 0) {
      await upsertAlert({
        type: "AMC_EXPIRED",
        key: a.id,
        severity: "CRITICAL",
        message: `AMC ${a.contractNumber ?? a.id} expired ${-days}d ago`,
        dayKey: todayStr,
      });
      incr("AMC_EXPIRED");
    } else if (days <= 45) {
      await upsertAlert({
        type: "AMC_EXPIRING_45",
        key: a.id,
        severity: "WARNING",
        message: `AMC ${a.contractNumber ?? a.id} expires in ${days}d`,
        dayKey: todayStr,
      });
      incr("AMC_EXPIRING_45");
    }
  }

  // ---- 6. Overdue POs ----
  const pos = await scanItems<PoRow>("PurchaseOrder", {
    FilterExpression: "#s IN (:s1, :s2)",
    ExpressionAttributeNames: { "#s": "status" },
    ExpressionAttributeValues: { ":s1": "SENT_TO_VENDOR", ":s2": "PARTIALLY_RECEIVED" },
  });
  for (const p of pos) {
    if (!p.expectedDeliveryDate) continue;
    const days = daysBetween(new Date(p.expectedDeliveryDate), today);
    if (days <= 0) continue;
    await upsertAlert({
      type: "PO_OVERDUE",
      key: p.id,
      severity: "WARNING",
      message: `PO ${p.poNumber ?? p.id} overdue by ${days}d`,
      dayKey: todayStr,
    });
    incr("PO_OVERDUE");
  }

  await writeAudit({
    actorRole: "SYSTEM",
    action: "ALERT_ENGINE_RUN",
    entityType: "AlertRun",
    entityId: todayStr,
    after: { counts, totalAlerts: Object.values(counts).reduce((a, b) => a + b, 0) },
  });

  console.info("[alert-engine] done:", counts);
};

async function upsertAlert(args: {
  type: string;
  key: string;
  dayKey: string;
  severity: "INFO" | "WARNING" | "CRITICAL";
  message: string;
  productId?: string;
  unitId?: string;
  projectId?: string;
}): Promise<void> {
  const id = `${args.type}#${args.dayKey}#${args.key}`;
  const existing = await getItem("StockAlert", { id }).catch(() => undefined);
  if (existing) return; // idempotent — already generated this alert today

  const now = new Date().toISOString();
  await putItem("StockAlert", {
    id,
    alertType: args.type,
    severity: args.severity,
    productId: args.productId,
    unitId: args.unitId,
    projectId: args.projectId,
    message: args.message,
    generatedAt: now,
    isActive: "TRUE",
    createdAt: now,
    updatedAt: now,
  });
}
