/**
 * invoice-scheduler — creates the 8-stage EventBridge Scheduler set for an invoice.
 *
 * Invoked on invoice CRUD events (AppSync mutation resolver, or DynamoDB stream):
 *   - CREATE / SENT:   create all 8 schedules
 *   - UPDATE dueDate:  delete + recreate the schedules
 *   - PAID / CANCELLED: delete all schedules (bill no longer needs chasing)
 *
 * Schedule stages (relative to invoice dueDate):
 *   T-15, T-7, T_ZERO, T+1, T+7, T+14, T+30, T+45
 *
 * Each schedule targets `payment-reminder-sender` with a payload identifying
 * the invoice and stage, so the sender doesn't need to know the timing logic.
 *
 * Schedules are named `inv-{invoiceId}-{STAGE}` so a single prefix delete
 * tears down all 8 at once (on PAID or CANCELLED).
 */
import { addDays } from "date-fns";
import {
  upsertOneOffSchedule,
  deleteSchedulesByPrefix,
} from "../_lib/scheduler.js";
import { getItem } from "../_lib/ddb.js";
import { writeAudit } from "../_lib/audit.js";

export type Action = "CREATE" | "UPDATE" | "CANCEL";

interface Input {
  action: Action;
  invoiceId: string;
  actorUserId?: string;
}

interface InvoiceRow {
  id: string;
  invoiceNumber: string;
  dueDate: string; // YYYY-MM-DD
  status?: string;
  clientId?: string;
  salespersonUserId?: string;
}

export interface Output {
  scheduled: number;
  deleted: number;
  stages: string[];
}

const STAGES: Array<{ name: string; offsetDays: number }> = [
  { name: "T_MINUS_15", offsetDays: -15 },
  { name: "T_MINUS_7", offsetDays: -7 },
  { name: "T_ZERO", offsetDays: 0 },
  { name: "T_PLUS_1", offsetDays: 1 },
  { name: "T_PLUS_7", offsetDays: 7 },
  { name: "T_PLUS_14", offsetDays: 14 },
  { name: "T_PLUS_30", offsetDays: 30 },
  { name: "T_PLUS_45", offsetDays: 45 },
];

export const handler = async (event: Input): Promise<Output> => {
  if (!event?.invoiceId) throw new Error("invoiceId is required");
  if (!event.action) throw new Error("action is required (CREATE | UPDATE | CANCEL)");

  const prefix = `inv-${event.invoiceId}-`;

  if (event.action === "CANCEL") {
    const deleted = await deleteSchedulesByPrefix(prefix);
    await writeAudit({
      actorUserId: event.actorUserId,
      action: "INVOICE_REMINDERS_CANCELLED",
      entityType: "ClientInvoice",
      entityId: event.invoiceId,
      after: { schedulesDeleted: deleted },
    });
    return { scheduled: 0, deleted, stages: [] };
  }

  const invoice = await getItem<InvoiceRow>("ClientInvoice", { id: event.invoiceId });
  if (!invoice) throw new Error(`Invoice ${event.invoiceId} not found`);
  if (!invoice.dueDate) throw new Error(`Invoice ${invoice.invoiceNumber} has no dueDate`);

  // UPDATE = teardown + rebuild with new dueDate.
  let deleted = 0;
  if (event.action === "UPDATE") {
    deleted = await deleteSchedulesByPrefix(prefix);
  }

  const targetArn = requiredEnv("PAYMENT_REMINDER_SENDER_ARN");
  const roleArn = requiredEnv("SCHEDULER_INVOKE_ROLE_ARN");
  const dueDate = new Date(invoice.dueDate);
  const now = new Date();

  const created: string[] = [];
  for (const stage of STAGES) {
    const fireAt = addDays(dueDate, stage.offsetDays);
    // Past-due stages: Scheduler refuses schedules in the past, so we skip
    // any stage whose fire-time has already elapsed. The daily MSME checker
    // + payment-reminder daily sweep catch those.
    if (fireAt.getTime() <= now.getTime()) continue;

    await upsertOneOffSchedule({
      name: `${prefix}${stage.name}`,
      at: fireAt,
      targetLambdaArn: targetArn,
      roleArn,
      description: `Payment reminder ${stage.name} for invoice ${invoice.invoiceNumber}`,
      payload: {
        invoiceId: invoice.id,
        stage: stage.name,
      },
    });
    created.push(stage.name);
  }

  await writeAudit({
    actorUserId: event.actorUserId,
    action: event.action === "UPDATE" ? "INVOICE_REMINDERS_REBUILT" : "INVOICE_REMINDERS_CREATED",
    entityType: "ClientInvoice",
    entityId: event.invoiceId,
    after: {
      invoiceNumber: invoice.invoiceNumber,
      dueDate: invoice.dueDate,
      schedulesCreated: created,
      schedulesDeleted: deleted,
    },
  });

  return { scheduled: created.length, deleted, stages: created };
};

function requiredEnv(key: string): string {
  const v = process.env[key];
  if (!v) throw new Error(`${key} env var not set — invoice-scheduler misconfigured`);
  return v;
}
