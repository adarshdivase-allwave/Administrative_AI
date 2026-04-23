/**
 * warranty-alert-monthly — runs 1st monthly @ 07:00 IST.
 *
 * Sends a grouped-by-godown digest of every unit whose warranty expires in
 * the next 90 days. This is the "monthly planning view" — the daily
 * alert-engine produces real-time per-unit alerts.
 */
import type { ScheduledHandler } from "aws-lambda";
import { scanItems } from "../_lib/ddb.js";
import { sendTemplatedEmail } from "../_lib/ses.js";
import { writeAudit } from "../_lib/audit.js";
import { daysBetween, formatIST } from "../../../shared/fy.js";

interface UnitRow {
  id: string;
  productId?: string;
  warrantyExpiryDate?: string;
  godownId?: string;
}
interface ProductRow {
  id: string;
  productName?: string;
  modelNumber?: string;
}
interface GodownRow {
  id: string;
  name?: string;
}

export const handler: ScheduledHandler = async () => {
  const today = new Date();
  const units = await scanItems<UnitRow>("UnitRecord", {
    FilterExpression: "attribute_exists(warrantyExpiryDate)",
  });

  const expiring = units.filter((u) => {
    if (!u.warrantyExpiryDate) return false;
    const d = daysBetween(today, new Date(u.warrantyExpiryDate));
    return d >= 0 && d <= 90;
  });

  if (!expiring.length) {
    console.info("[warranty-alert-monthly] no warranties expiring in 90d");
    return;
  }

  const productIds = [...new Set(expiring.map((u) => u.productId).filter(Boolean) as string[])];
  const godownIds = [...new Set(expiring.map((u) => u.godownId).filter(Boolean) as string[])];
  const [products, godowns] = await Promise.all([
    Promise.all(productIds.map((id) => lookup<ProductRow>("ProductMaster", id))),
    Promise.all(godownIds.map((id) => lookup<GodownRow>("Godown", id))),
  ]);
  const productById = new Map(products.filter(Boolean).map((p) => [p!.id, p!]));
  const godownById = new Map(godowns.filter(Boolean).map((g) => [g!.id, g!]));

  // Group by godown.
  const byGodown = new Map<string, UnitRow[]>();
  for (const u of expiring) {
    const key = u.godownId ?? "unassigned";
    const arr = byGodown.get(key) ?? [];
    arr.push(u);
    byGodown.set(key, arr);
  }

  const html = [...byGodown.entries()]
    .map(([gid, us]) => {
      const godownName = godownById.get(gid)?.name ?? "Unassigned";
      const rows = us
        .map((u) => {
          const p = productById.get(u.productId ?? "");
          return `<tr>
            <td>${p?.productName ?? "(unknown)"}${p?.modelNumber ? ` — ${p.modelNumber}` : ""}</td>
            <td>${u.id}</td>
            <td>${formatIST(new Date(u.warrantyExpiryDate!))}</td>
            <td>${daysBetween(today, new Date(u.warrantyExpiryDate!))} days</td>
          </tr>`;
        })
        .join("");
      return `<h3>${godownName} (${us.length} units)</h3>
        <table border="1" cellpadding="4" cellspacing="0" style="border-collapse: collapse;">
          <tr><th>Product</th><th>Unit ID</th><th>Expiry</th><th>In</th></tr>
          ${rows}
        </table>`;
    })
    .join("\n");

  const recipients = (process.env.DIGEST_ADMIN_EMAILS ?? "").split(",").filter(Boolean);
  if (recipients.length === 0) {
    console.warn("[warranty-alert-monthly] no Admin digest recipients configured");
    return;
  }

  await sendTemplatedEmail({
    to: recipients,
    templateName: "ALERT_WARRANTY_EXPIRING",
    templateData: {
      unitCount: expiring.length,
      digestDate: formatIST(today),
      unitsHtml: html,
    },
  });

  await writeAudit({
    actorRole: "SYSTEM",
    action: "WARRANTY_DIGEST_SENT",
    entityType: "WarrantyDigest",
    entityId: today.toISOString().slice(0, 10),
    after: { expiringCount: expiring.length, godowns: byGodown.size },
  });
};

async function lookup<T>(model: string, id: string): Promise<T | undefined> {
  const { getItem } = await import("../_lib/ddb.js");
  return getItem<T>(model, { id });
}
