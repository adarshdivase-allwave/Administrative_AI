/**
 * invoice-confirmation-scheduler — two responsibilities:
 *
 *   1. MODE = "CREATE" (called on invoice SENT):
 *      Creates 3 EventBridge schedules targeting this same Lambda in
 *      MODE = "FIRE_STAGE" at D+3, D+7, D+10.
 *      Creates an InvoiceConfirmation row with a unique token so the client
 *      can one-click "Confirm Receipt" without logging in.
 *
 *   2. MODE = "FIRE_STAGE" (Lambda invoked by a scheduler target):
 *      Looks up the invoice's confirmation row. If already confirmed, exits.
 *      Otherwise:
 *        - D_3_REQUEST:         emails INVOICE_CONFIRMATION_REQUEST with signed link
 *        - D_7_FOLLOWUP:        sends the same request as a gentle follow-up
 *        - D_10_AUTO_ACCEPTANCE: flips the invoice to "deemed accepted" and
 *                                emails INVOICE_AUTO_ACCEPTANCE to the client
 *
 * The one-click "Confirm" endpoint is served by a different Lambda (to be
 * built in the portal-handler iteration) that looks up the token in
 * ClientPortalToken and marks the confirmation.
 */
import { randomUUID } from "node:crypto";
import { addDays } from "date-fns";
import { getItem, putItem, updateItem, queryItems } from "../_lib/ddb.js";
import { upsertOneOffSchedule, deleteSchedulesByPrefix } from "../_lib/scheduler.js";
import { sendTemplatedEmail } from "../_lib/ses.js";
import { writeAudit } from "../_lib/audit.js";
import { formatInr } from "../../../shared/currency.js";
import { formatIST } from "../../../shared/fy.js";

type Mode = "CREATE" | "FIRE_STAGE" | "CANCEL";
type Stage = "D_3_REQUEST" | "D_7_FOLLOWUP" | "D_10_AUTO_ACCEPTANCE";

interface Input {
  mode: Mode;
  invoiceId: string;
  stage?: Stage;
  actorUserId?: string;
}

interface InvoiceRow {
  id: string;
  invoiceNumber: string;
  invoiceDate: string;
  totalAmountInr: number;
  dueDate: string;
  clientId: string;
  status?: string;
}
interface ClientRow {
  id: string;
  name: string;
  contactEmail?: string;
  billingEmail?: string;
}
interface ConfirmationRow {
  id: string;
  invoiceId: string;
  status?: "PENDING" | "CONFIRMED" | "AUTO_ACCEPTED";
  confirmationToken?: string;
}

export const handler = async (event: Input): Promise<{ action: string; details?: unknown }> => {
  if (!event?.invoiceId || !event.mode) {
    throw new Error("invoiceId and mode are required");
  }

  if (event.mode === "CANCEL") {
    const deleted = await deleteSchedulesByPrefix(`conf-${event.invoiceId}-`);
    return { action: "cancelled", details: { deleted } };
  }

  const invoice = await getItem<InvoiceRow>("ClientInvoice", { id: event.invoiceId });
  if (!invoice) throw new Error(`Invoice ${event.invoiceId} not found`);

  if (event.mode === "CREATE") {
    return createSchedules(invoice, event.actorUserId);
  }

  if (event.mode === "FIRE_STAGE") {
    if (!event.stage) throw new Error("stage required for FIRE_STAGE");
    return fireStage(invoice, event.stage);
  }

  return { action: "noop" };
};

async function createSchedules(
  invoice: InvoiceRow,
  actorUserId?: string,
): Promise<{ action: "created"; details: unknown }> {
  // Idempotency — if a confirmation row already exists, we're rescheduling.
  const existing = await queryItems<ConfirmationRow>("InvoiceConfirmation", {
    IndexName: undefined,
    KeyConditionExpression: "invoiceId = :i",
    ExpressionAttributeValues: { ":i": invoice.id },
  }).catch(async () => {
    const { scanItems } = await import("../_lib/ddb.js");
    return scanItems<ConfirmationRow>("InvoiceConfirmation", {
      FilterExpression: "invoiceId = :i",
      ExpressionAttributeValues: { ":i": invoice.id },
    });
  });

  let token: string;
  if (existing.length > 0 && existing[0]!.confirmationToken) {
    token = existing[0]!.confirmationToken;
  } else {
    token = randomUUID().replace(/-/g, "");
    const now = new Date().toISOString();
    await putItem("InvoiceConfirmation", {
      id: randomUUID(),
      invoiceId: invoice.id,
      stage: "D_3_REQUEST",
      sentAt: undefined,
      confirmationToken: token,
      status: "PENDING",
      createdAt: now,
      updatedAt: now,
    });
  }

  const targetArn = requiredEnv("INVOICE_CONFIRMATION_SCHEDULER_ARN");
  const roleArn = requiredEnv("SCHEDULER_INVOKE_ROLE_ARN");
  const invoiceSentAt = new Date(); // assume "now" is the SENT moment

  const stages: Array<{ stage: Stage; days: number }> = [
    { stage: "D_3_REQUEST", days: 3 },
    { stage: "D_7_FOLLOWUP", days: 7 },
    { stage: "D_10_AUTO_ACCEPTANCE", days: 10 },
  ];

  await deleteSchedulesByPrefix(`conf-${invoice.id}-`);

  for (const s of stages) {
    await upsertOneOffSchedule({
      name: `conf-${invoice.id}-${s.stage}`,
      at: addDays(invoiceSentAt, s.days),
      targetLambdaArn: targetArn,
      roleArn,
      description: `${s.stage} for invoice ${invoice.invoiceNumber}`,
      payload: {
        mode: "FIRE_STAGE",
        invoiceId: invoice.id,
        stage: s.stage,
      },
    });
  }

  await writeAudit({
    actorUserId,
    action: "INVOICE_CONFIRMATION_SCHEDULED",
    entityType: "ClientInvoice",
    entityId: invoice.id,
    after: { token, stages: stages.map((s) => s.stage) },
  });

  return { action: "created", details: { token, stages: stages.map((s) => s.stage) } };
}

async function fireStage(
  invoice: InvoiceRow,
  stage: Stage,
): Promise<{ action: string; details?: unknown }> {
  const confs = await queryItems<ConfirmationRow>("InvoiceConfirmation", {
    IndexName: undefined,
    KeyConditionExpression: "invoiceId = :i",
    ExpressionAttributeValues: { ":i": invoice.id },
  }).catch(async () => {
    const { scanItems } = await import("../_lib/ddb.js");
    return scanItems<ConfirmationRow>("InvoiceConfirmation", {
      FilterExpression: "invoiceId = :i",
      ExpressionAttributeValues: { ":i": invoice.id },
    });
  });

  const conf = confs[0];
  if (!conf) {
    console.warn(`[invoice-confirmation] no confirmation row for ${invoice.id} — skipping`);
    return { action: "skipped", details: "no_confirmation_row" };
  }
  if (conf.status === "CONFIRMED") {
    return { action: "skipped", details: "already_confirmed" };
  }

  const client = await getItem<ClientRow>("Client", { id: invoice.clientId });
  if (!client) throw new Error(`Client ${invoice.clientId} not found`);
  const clientEmail = client.billingEmail ?? client.contactEmail;
  if (!clientEmail) throw new Error("Client has no email");

  const portalBase = process.env.CLIENT_PORTAL_BASE_URL ?? "https://portal.example.com";
  const confirmUrl = `${portalBase}/confirm?t=${encodeURIComponent(conf.confirmationToken ?? "")}`;

  const data = {
    invoiceNumber: invoice.invoiceNumber,
    invoiceDate: formatIST(new Date(invoice.invoiceDate)),
    amount: formatInr(invoice.totalAmountInr, { showSymbol: false }),
    dueDate: formatIST(new Date(invoice.dueDate)),
    clientName: client.name,
    confirmUrl,
    companyName: process.env.COMPANY_NAME ?? "Our Company",
  };

  const now = new Date().toISOString();
  if (stage === "D_3_REQUEST" || stage === "D_7_FOLLOWUP") {
    const messageId = await sendTemplatedEmail({
      to: [clientEmail],
      templateName: "INVOICE_CONFIRMATION_REQUEST",
      templateData: data,
    });
    await updateItem("InvoiceConfirmation", { id: conf.id }, {
      UpdateExpression: "SET stage = :st, sentAt = :t, updatedAt = :t",
      ExpressionAttributeValues: { ":st": stage, ":t": now },
    });
    return { action: "email_sent", details: { messageId, stage } };
  }

  // D_10_AUTO_ACCEPTANCE
  const messageId = await sendTemplatedEmail({
    to: [clientEmail],
    templateName: "INVOICE_AUTO_ACCEPTANCE",
    templateData: data,
  });
  await updateItem("InvoiceConfirmation", { id: conf.id }, {
    UpdateExpression: "SET stage = :st, #s = :cs, sentAt = :t, updatedAt = :t",
    ExpressionAttributeNames: { "#s": "status" },
    ExpressionAttributeValues: {
      ":st": "D_10_AUTO_ACCEPTANCE",
      ":cs": "AUTO_ACCEPTED",
      ":t": now,
    },
  });
  await writeAudit({
    actorRole: "SYSTEM",
    action: "INVOICE_AUTO_ACCEPTED",
    entityType: "ClientInvoice",
    entityId: invoice.id,
    after: { invoiceNumber: invoice.invoiceNumber, messageId },
  });
  return { action: "auto_accepted", details: { messageId } };
}

function requiredEnv(key: string): string {
  const v = process.env[key];
  if (!v) throw new Error(`${key} env var not set`);
  return v;
}
