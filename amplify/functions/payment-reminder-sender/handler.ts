/**
 * payment-reminder-sender — target of the 8 per-invoice EventBridge schedules
 * created by `invoice-scheduler`. Sends the stage-appropriate SES email and
 * writes a PaymentReminderLog row.
 *
 * Input (EventBridge schedule payload):
 *   { invoiceId: string, stage: "T_MINUS_15" | ... | "T_PLUS_45" }
 *
 * Stage → SES template mapping:
 *   T_MINUS_15  → PAYMENT_REMINDER_15D   (to client)
 *   T_MINUS_7   → PAYMENT_REMINDER_7D    (to client)
 *   T_ZERO      → PAYMENT_REMINDER_DUE   (to client) + PAYMENT_SALESPERSON_ALERT
 *   T_PLUS_1    → PAYMENT_REMINDER_OVERDUE (daysOverdue=1)
 *   T_PLUS_7    → PAYMENT_REMINDER_OVERDUE (daysOverdue=7) + salesperson alert
 *   T_PLUS_14   → PAYMENT_REMINDER_OVERDUE (daysOverdue=14) + Admin CC
 *   T_PLUS_30   → (MSME flow is triggered separately by msme-compliance-checker)
 *   T_PLUS_45   → (final MSME escalation handled by msme-compliance-checker)
 *
 * Skips sending if the invoice has already been PAID or CANCELLED.
 */
import { randomUUID } from "node:crypto";
import { getItem, putItem } from "../_lib/ddb.js";
import { sendTemplatedEmail, type TemplateData } from "../_lib/ses.js";
import { writeAudit } from "../_lib/audit.js";
import { formatInr } from "../../../shared/currency.js";
import { formatIST, daysBetween } from "../../../shared/fy.js";

type Stage =
  | "T_MINUS_15"
  | "T_MINUS_7"
  | "T_ZERO"
  | "T_PLUS_1"
  | "T_PLUS_7"
  | "T_PLUS_14"
  | "T_PLUS_30"
  | "T_PLUS_45";

interface Input {
  invoiceId: string;
  stage: Stage;
}

interface InvoiceRow {
  id: string;
  invoiceNumber: string;
  dueDate: string;
  totalAmountInr: number;
  amountDueInr: number;
  clientId: string;
  salespersonUserId?: string;
  status?: string;
}
interface ClientRow {
  id: string;
  name: string;
  contactEmail?: string;
  billingEmail?: string;
}
interface UserRow {
  id: string;
  email?: string;
  givenName?: string;
}

export const handler = async (event: Input): Promise<{ skipped?: string; sent?: boolean }> => {
  if (!event?.invoiceId || !event.stage) {
    throw new Error("invoiceId and stage are required");
  }

  const invoice = await getItem<InvoiceRow>("ClientInvoice", { id: event.invoiceId });
  if (!invoice) {
    console.warn(`[payment-reminder-sender] invoice ${event.invoiceId} not found`);
    return { skipped: "invoice_not_found" };
  }

  // Terminal statuses short-circuit every remaining stage.
  if (invoice.status === "PAID" || invoice.status === "CANCELLED") {
    return { skipped: `invoice_status_${invoice.status}` };
  }

  // MSME flow owns these two stages.
  if (event.stage === "T_PLUS_30" || event.stage === "T_PLUS_45") {
    return { skipped: "handled_by_msme_checker" };
  }

  const client = await getItem<ClientRow>("Client", { id: invoice.clientId });
  if (!client) throw new Error(`Client ${invoice.clientId} not found`);

  const today = new Date();
  const daysOverdue = Math.max(
    0,
    daysBetween(new Date(invoice.dueDate), today),
  );

  const sharedTemplateData: TemplateData = {
    invoiceNumber: invoice.invoiceNumber,
    clientName: client.name,
    totalAmount: formatInr(invoice.totalAmountInr, { showSymbol: false }),
    amountDue: formatInr(invoice.amountDueInr, { showSymbol: false }),
    dueDate: formatIST(new Date(invoice.dueDate)),
    daysOverdue,
    companyName: process.env.COMPANY_NAME ?? "Your Company",
    logoUrl: process.env.COMPANY_LOGO_PUBLIC_URL ?? "",
  };

  const clientEmail = client.billingEmail ?? client.contactEmail;
  if (!clientEmail) {
    throw new Error(`Client ${client.name} has no billing/contact email`);
  }

  // Map stage → template + recipients.
  let templateName = "";
  let to: string[] = [clientEmail];
  let cc: string[] | undefined;
  let alsoAlertSalesperson = false;

  switch (event.stage) {
    case "T_MINUS_15":
      templateName = "PAYMENT_REMINDER_15D";
      break;
    case "T_MINUS_7":
      templateName = "PAYMENT_REMINDER_7D";
      break;
    case "T_ZERO":
      templateName = "PAYMENT_REMINDER_DUE";
      alsoAlertSalesperson = true;
      break;
    case "T_PLUS_1":
      templateName = "PAYMENT_REMINDER_OVERDUE";
      break;
    case "T_PLUS_7":
      templateName = "PAYMENT_REMINDER_OVERDUE";
      alsoAlertSalesperson = true;
      break;
    case "T_PLUS_14": {
      templateName = "PAYMENT_REMINDER_OVERDUE";
      const adminEmail = process.env.COMPANY_OPS_EMAIL;
      if (adminEmail) cc = [adminEmail];
      alsoAlertSalesperson = true;
      break;
    }
  }

  const messageId = await sendTemplatedEmail({
    to,
    cc,
    templateName,
    templateData: sharedTemplateData,
  });

  await logReminder({
    invoiceId: invoice.id,
    stage: event.stage,
    recipientEmails: [clientEmail, ...(cc ?? [])],
    templateUsed: templateName,
    sesMessageId: messageId,
  });

  // Update invoice status to reflect the most-recent reminder stage.
  const newStatus =
    event.stage === "T_ZERO"
      ? "DUE_TODAY"
      : event.stage.startsWith("T_PLUS")
        ? "OVERDUE"
        : "REMINDER_SENT";
  await updateInvoiceStatus(invoice.id, newStatus);

  // Salesperson escalation.
  if (alsoAlertSalesperson && invoice.salespersonUserId) {
    const sp = await getItem<UserRow>("User", { id: invoice.salespersonUserId }).catch(
      () => undefined,
    );
    if (sp?.email) {
      const spMsgId = await sendTemplatedEmail({
        to: [sp.email],
        templateName: "PAYMENT_SALESPERSON_ALERT",
        templateData: { ...sharedTemplateData, salespersonName: sp.givenName ?? "" },
      });
      await logReminder({
        invoiceId: invoice.id,
        stage: "SALESPERSON_ALERT",
        recipientEmails: [sp.email],
        templateUsed: "PAYMENT_SALESPERSON_ALERT",
        sesMessageId: spMsgId,
      });
    }
  }

  await writeAudit({
    actorRole: "SYSTEM",
    action: "PAYMENT_REMINDER_SENT",
    entityType: "ClientInvoice",
    entityId: invoice.id,
    after: { stage: event.stage, template: templateName, messageId },
  });

  return { sent: true };
};

async function logReminder(row: {
  invoiceId: string;
  stage: string;
  recipientEmails: string[];
  templateUsed: string;
  sesMessageId: string;
}): Promise<void> {
  const now = new Date().toISOString();
  await putItem("PaymentReminderLog", {
    id: randomUUID(),
    invoiceId: row.invoiceId,
    stage: row.stage,
    sentAt: now,
    channel: "EMAIL",
    recipientEmails: row.recipientEmails,
    templateUsed: row.templateUsed,
    sesMessageId: row.sesMessageId,
    createdAt: now,
    updatedAt: now,
  });
}

async function updateInvoiceStatus(invoiceId: string, status: string): Promise<void> {
  const { updateItem } = await import("../_lib/ddb.js");
  await updateItem("ClientInvoice", { id: invoiceId }, {
    UpdateExpression: "SET #s = :s, updatedAt = :t",
    ExpressionAttributeNames: { "#s": "status" },
    ExpressionAttributeValues: {
      ":s": status,
      ":t": new Date().toISOString(),
    },
  });
}
