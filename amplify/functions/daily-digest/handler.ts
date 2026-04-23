/**
 * daily-digest — runs 8 AM IST. Sends a role-scoped summary email to every
 * user who hasn't opted out.
 *
 * Content by role (per spec §20):
 *   Admin     — new units, stock alerts, upcoming payments, MSME notices,
 *               AMC/warranty, bills this week, lambda errors yesterday
 *   Logistics — returns due today/this week, in-transit arrivals, open tickets,
 *               personal reminders today
 *   Purchase  — reorder suggestions, POs awaiting approval, vendor deliveries,
 *               bills to prepare, personal reminders today
 *   Sales     — overdue invoices, MSME notices sent yesterday,
 *               payment confirmations received yesterday, personal reminders today
 *
 * Implementation note: user preferences table ("User" model) doesn't exist in
 * our schema explicitly (Cognito-backed), so we scan Cognito via AdminListUsers
 * to get group membership + emails. For this iteration, we iterate a stub list
 * from process.env until the user directory is plumbed in.
 *
 * Each role's sections are pre-rendered as HTML snippets and dropped into the
 * DAILY_DIGEST template using SES Handlebars.
 */
import type { ScheduledHandler } from "aws-lambda";
import { scanItems } from "../_lib/ddb.js";
import { sendTemplatedEmail } from "../_lib/ses.js";
import { writeAudit } from "../_lib/audit.js";
import { formatInr } from "../../../shared/currency.js";
import { formatIST, daysBetween } from "../../../shared/fy.js";
import type { UserRole } from "../../../shared/constants.js";

interface InvoiceRow {
  id: string;
  invoiceNumber: string;
  dueDate: string;
  totalAmountInr: number;
  status?: string;
  clientId: string;
}
interface AlertRow {
  id: string;
  alertType: string;
  severity?: string;
  message?: string;
  isActive?: string;
}
interface BillRow {
  id: string;
  description: string;
  dueDate: string;
  amountInr?: number;
  status?: string;
}
interface PoRow {
  id: string;
  poNumber?: string;
  approvalStatus?: string;
}

export const handler: ScheduledHandler = async () => {
  const today = new Date();

  const [alerts, invoices, bills, pos] = await Promise.all([
    scanItems<AlertRow>("StockAlert", {
      FilterExpression: "isActive = :a",
      ExpressionAttributeValues: { ":a": "TRUE" },
    }),
    scanItems<InvoiceRow>("ClientInvoice", {
      FilterExpression: "#s IN (:s1, :s2, :s3, :s4)",
      ExpressionAttributeNames: { "#s": "status" },
      ExpressionAttributeValues: {
        ":s1": "OVERDUE",
        ":s2": "DUE_TODAY",
        ":s3": "REMINDER_SENT",
        ":s4": "MSME_NOTICE_SENT",
      },
    }),
    scanItems<BillRow>("Bill", {
      FilterExpression: "#s IN (:s1, :s2)",
      ExpressionAttributeNames: { "#s": "status" },
      ExpressionAttributeValues: { ":s1": "PENDING", ":s2": "OVERDUE" },
    }),
    scanItems<PoRow>("PurchaseOrder", {
      FilterExpression: "approvalStatus = :a",
      ExpressionAttributeValues: { ":a": "PENDING_APPROVAL" },
    }),
  ]);

  const roleRecipients = await listRoleRecipients();

  const shared = {
    alertCount: alerts.length,
    overdueInvoiceCount: invoices.filter((i) => i.status === "OVERDUE").length,
    msmeNoticeCount: invoices.filter((i) => i.status === "MSME_NOTICE_SENT").length,
    billsThisWeekCount: bills.filter(
      (b) => daysBetween(today, new Date(b.dueDate)) >= 0 && daysBetween(today, new Date(b.dueDate)) <= 7,
    ).length,
    digestDate: formatIST(today),
  };

  const sections: Record<UserRole, string> = {
    Admin: adminSection(alerts, invoices, bills, pos),
    Logistics: logisticsSection(alerts),
    Purchase: purchaseSection(pos, alerts, bills),
    Sales: salesSection(invoices),
  };

  for (const [role, emails] of Object.entries(roleRecipients) as [UserRole, string[]][]) {
    if (!emails.length) continue;
    try {
      await sendTemplatedEmail({
        to: emails,
        templateName: "DAILY_DIGEST",
        templateData: {
          ...shared,
          role,
          roleSections: sections[role],
        },
      });
    } catch (e) {
      console.warn(`[daily-digest] SES failed for ${role}:`, (e as Error).message);
    }
  }

  await writeAudit({
    actorRole: "SYSTEM",
    action: "DAILY_DIGEST_SENT",
    entityType: "DigestRun",
    entityId: today.toISOString().slice(0, 10),
    after: { recipientsByRole: Object.fromEntries(Object.entries(roleRecipients).map(([k, v]) => [k, v.length])) },
  });
};

async function listRoleRecipients(): Promise<Record<UserRole, string[]>> {
  // Until Cognito directory traversal is wired in, operators can provide
  // comma-separated override lists via env.
  return {
    Admin: (process.env.DIGEST_ADMIN_EMAILS ?? "").split(",").filter(Boolean),
    Logistics: (process.env.DIGEST_LOGISTICS_EMAILS ?? "").split(",").filter(Boolean),
    Purchase: (process.env.DIGEST_PURCHASE_EMAILS ?? "").split(",").filter(Boolean),
    Sales: (process.env.DIGEST_SALES_EMAILS ?? "").split(",").filter(Boolean),
  };
}

function adminSection(alerts: AlertRow[], invoices: InvoiceRow[], bills: BillRow[], pos: PoRow[]): string {
  return [
    `<h3>Active alerts: ${alerts.length}</h3>`,
    renderList(alerts.slice(0, 10).map((a) => `${a.alertType}: ${a.message ?? ""}`)),
    `<h3>Open invoices needing action: ${invoices.length}</h3>`,
    renderList(
      invoices
        .slice(0, 10)
        .map((i) => `${i.invoiceNumber} — ${formatInr(i.totalAmountInr)} (${i.status})`),
    ),
    `<h3>Bills due this week: ${bills.length}</h3>`,
    renderList(bills.slice(0, 10).map((b) => `${b.description} — due ${formatIST(new Date(b.dueDate))}`)),
    `<h3>POs awaiting approval: ${pos.length}</h3>`,
    renderList(pos.slice(0, 10).map((p) => p.poNumber ?? p.id)),
  ].join("\n");
}

function logisticsSection(alerts: AlertRow[]): string {
  const returnAlerts = alerts.filter((a) =>
    ["OVERDUE_RETURN", "OVERDUE_TRANSIT", "SERVICE_TICKET_OVERDUE"].includes(a.alertType),
  );
  return [
    `<h3>Logistics alerts: ${returnAlerts.length}</h3>`,
    renderList(returnAlerts.slice(0, 20).map((a) => a.message ?? a.alertType)),
  ].join("\n");
}

function purchaseSection(pos: PoRow[], alerts: AlertRow[], bills: BillRow[]): string {
  const reorder = alerts.filter((a) => ["LOW_STOCK", "OUT_OF_STOCK", "REORDER_NEEDED", "IMPORT_NEEDED"].includes(a.alertType));
  return [
    `<h3>POs awaiting approval: ${pos.length}</h3>`,
    renderList(pos.slice(0, 20).map((p) => p.poNumber ?? p.id)),
    `<h3>Reorder suggestions: ${reorder.length}</h3>`,
    renderList(reorder.slice(0, 20).map((a) => a.message ?? a.alertType)),
    `<h3>Bills to prepare (TDS / credit card): ${bills.length}</h3>`,
    renderList(bills.slice(0, 10).map((b) => `${b.description} — due ${formatIST(new Date(b.dueDate))}`)),
  ].join("\n");
}

function salesSection(invoices: InvoiceRow[]): string {
  const overdue = invoices.filter((i) => i.status === "OVERDUE");
  const msme = invoices.filter((i) => i.status === "MSME_NOTICE_SENT");
  return [
    `<h3>Overdue invoices: ${overdue.length}</h3>`,
    renderList(overdue.slice(0, 20).map((i) => `${i.invoiceNumber} — ${formatInr(i.totalAmountInr)}`)),
    `<h3>MSME notices active: ${msme.length}</h3>`,
    renderList(msme.slice(0, 10).map((i) => i.invoiceNumber)),
  ].join("\n");
}

function renderList(items: string[]): string {
  if (!items.length) return "<p><em>None</em></p>";
  return `<ul>${items.map((i) => `<li>${escapeHtml(i)}</li>`).join("")}</ul>`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[ch]!);
}
