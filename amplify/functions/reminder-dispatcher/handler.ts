/**
 * reminder-dispatcher â€” dual mode:
 *
 *   MODE = "SYNC_SCHEDULES" (called from Reminder CRUD mutations):
 *     - UPSERT: creates/updates the EventBridge schedule for the Reminder
 *     - DELETE: removes it
 *
 *   MODE = "FIRE" (target of the scheduler):
 *     - Looks up the Reminder row
 *     - Sends STAFF_REMINDER email to the user (if they have an email)
 *     - Appends a ReminderLog entry
 *     - If recurring, schedules the next occurrence
 */
import { randomUUID } from "node:crypto";
import { addDays, addMonths, addWeeks } from "date-fns";
import { getItem, putItem, updateItem } from "../_lib/ddb.js";
import {
  upsertOneOffSchedule,
  deleteSchedule,
} from "../_lib/scheduler.js";
import { sendTemplatedEmail } from "../_lib/ses.js";
import { writeAudit } from "../_lib/audit.js";
import { formatIST } from "../../../shared/fy.js";

type Mode = "SYNC_SCHEDULES" | "FIRE";
type Op = "UPSERT" | "DELETE";

interface Input {
  mode: Mode;
  reminderId: string;
  op?: Op;
}

interface ReminderRow {
  id: string;
  userId: string;
  title: string;
  body?: string;
  remindAt: string;
  recurring?: boolean;
  cronExpression?: string;
  eventBridgeScheduleArn?: string;
  status?: "ACTIVE" | "COMPLETED" | "CANCELLED";
  relatedEntityType?: string;
  relatedEntityId?: string;
}

interface UserRow {
  id: string;
  email?: string;
  givenName?: string;
}

export const handler = async (
  rawEvent: Input | { arguments?: Partial<Input> & { op?: Op } },
): Promise<{ action: string }> => {
  // AppSync passes only { reminderId, op }; EventBridge / CLI pass { mode, reminderId }.
  const args =
    (rawEvent as { arguments?: Partial<Input> & { op?: Op } }).arguments ??
    (rawEvent as Partial<Input> & { op?: Op });
  const reminderId = args.reminderId;
  if (!reminderId) {
    throw new Error("reminderId is required");
  }
  const mode: Mode =
    args.mode === "FIRE" || args.mode === "SYNC_SCHEDULES"
      ? args.mode
      : args.op !== undefined
        ? "SYNC_SCHEDULES"
        : "FIRE";

  if (mode === "SYNC_SCHEDULES") {
    return syncSchedule(reminderId, args.op ?? "UPSERT");
  }

  if (mode === "FIRE") {
    return fireReminder(reminderId);
  }

  return { action: "noop" };
};

async function syncSchedule(
  reminderId: string,
  op: Op,
): Promise<{ action: string }> {
  const scheduleName = `reminder-${reminderId}`;

  if (op === "DELETE") {
    await deleteSchedule(scheduleName);
    return { action: "deleted" };
  }

  const rem = await getItem<ReminderRow>("Reminder", { id: reminderId });
  if (!rem) throw new Error(`Reminder ${reminderId} not found`);
  if (rem.status !== "ACTIVE") {
    await deleteSchedule(scheduleName);
    return { action: "deleted_non_active" };
  }

  const targetArn = requiredEnv("REMINDER_DISPATCHER_ARN");
  const roleArn = requiredEnv("SCHEDULER_INVOKE_ROLE_ARN");

  await upsertOneOffSchedule({
    name: scheduleName,
    at: new Date(rem.remindAt),
    targetLambdaArn: targetArn,
    roleArn,
    description: `Reminder: ${rem.title}`,
    payload: { mode: "FIRE", reminderId: rem.id },
  });

  return { action: "scheduled" };
}

async function fireReminder(reminderId: string): Promise<{ action: string }> {
  const rem = await getItem<ReminderRow>("Reminder", { id: reminderId });
  if (!rem) {
    console.warn(`[reminder-dispatcher] reminder ${reminderId} disappeared before firing`);
    return { action: "skipped_not_found" };
  }
  if (rem.status !== "ACTIVE") {
    return { action: "skipped_not_active" };
  }

  const user = await getItem<UserRow>("User", { id: rem.userId }).catch(() => undefined);
  let sesMessageId: string | undefined;
  if (user?.email) {
    try {
      sesMessageId = await sendTemplatedEmail({
        to: [user.email],
        templateName: "STAFF_REMINDER",
        templateData: {
          reminderTitle: rem.title,
          reminderBody: rem.body ?? "",
          recipientName: user.givenName ?? "",
          remindAt: formatIST(new Date(rem.remindAt)),
        },
      });
    } catch (e) {
      console.warn("[reminder-dispatcher] SES send failed:", (e as Error).message);
    }
  }

  const now = new Date().toISOString();
  await putItem("ReminderLog", {
    id: randomUUID(),
    reminderId: rem.id,
    firedAt: now,
    channel: user?.email ? "BOTH" : "IN_APP",
    sesMessageId,
    createdAt: now,
    updatedAt: now,
  });

  if (rem.recurring && rem.cronExpression) {
    // Simple recurrence support: if cronExpression is a shorthand like
    // "DAILY" / "WEEKLY" / "MONTHLY", advance the remindAt and reschedule.
    const nextAt = nextOccurrence(new Date(rem.remindAt), rem.cronExpression);
    if (nextAt) {
      await updateItem("Reminder", { id: rem.id }, {
        UpdateExpression: "SET remindAt = :t, updatedAt = :t",
        ExpressionAttributeValues: { ":t": nextAt.toISOString() },
      });
      await syncSchedule(rem.id, "UPSERT");
    }
  } else {
    await updateItem("Reminder", { id: rem.id }, {
      UpdateExpression: "SET #s = :c, updatedAt = :t",
      ExpressionAttributeNames: { "#s": "status" },
      ExpressionAttributeValues: { ":c": "COMPLETED", ":t": now },
    });
  }

  await writeAudit({
    actorRole: "SYSTEM",
    action: "REMINDER_FIRED",
    entityType: "Reminder",
    entityId: rem.id,
    after: { title: rem.title, sesMessageId, recurring: rem.recurring ?? false },
  });

  return { action: "fired" };
}

function nextOccurrence(prev: Date, expr: string): Date | null {
  const e = expr.trim().toUpperCase();
  if (e === "DAILY") return addDays(prev, 1);
  if (e === "WEEKLY") return addWeeks(prev, 1);
  if (e === "MONTHLY") return addMonths(prev, 1);
  // Full cron support deferred â€” operators set DAILY/WEEKLY/MONTHLY for now.
  return null;
}

function requiredEnv(key: string): string {
  const v = process.env[key];
  if (!v) throw new Error(`${key} env var not set`);
  return v;
}
