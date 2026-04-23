/**
 * EventBridge Scheduler helpers for per-invoice / per-bill one-off schedules.
 *
 * Unlike the fixed schedules in `amplify/custom/eventbridge-schedules.ts`
 * (which are defined at synth time), these are created at runtime because
 * their count scales with document volume — potentially thousands in flight.
 *
 * Naming convention (so we can tear down a whole set in one list call):
 *   `inv-{invoiceId}-{stage}`        — e.g. inv-abc123-T_MINUS_15
 *   `conf-{invoiceId}-{stage}`       — e.g. conf-abc123-D_3_REQUEST
 *   `bill-{billId}`
 *   `reminder-{reminderId}`
 */
import {
  CreateScheduleCommand,
  DeleteScheduleCommand,
  ListSchedulesCommand,
  type CreateScheduleCommandInput,
} from "@aws-sdk/client-scheduler";
import { schedulerClient } from "./aws-clients.js";

export interface OneOffScheduleInput {
  /** Globally unique short identifier for the schedule (≤ 64 chars). */
  name: string;
  /** When the schedule should fire — UTC Date or ISO string. */
  at: Date | string;
  /** Target Lambda ARN. */
  targetLambdaArn: string;
  /** Payload passed to the target Lambda as EventBridge `input`. */
  payload: Record<string, unknown>;
  /** IAM role ARN that scheduler assumes to invoke the Lambda. */
  roleArn: string;
  description?: string;
  /** Defaults to the env-specific schedule group. */
  groupName?: string;
}

function defaultGroup(): string {
  return `av-inventory-${(process.env.APP_ENV ?? "dev").toLowerCase()}`;
}

function toSchedulerTimestamp(at: Date | string): string {
  // EventBridge Scheduler `at()` expression needs YYYY-MM-DDTHH:MM:SS (no ms, no Z).
  const iso = typeof at === "string" ? at : at.toISOString();
  return iso.replace(/\.\d+Z$/, "").replace(/Z$/, "");
}

/** Creates or updates a one-off schedule. Idempotent on `name`. */
export async function upsertOneOffSchedule(input: OneOffScheduleInput): Promise<void> {
  const at = toSchedulerTimestamp(input.at);
  const cmdInput: CreateScheduleCommandInput = {
    Name: input.name,
    GroupName: input.groupName ?? defaultGroup(),
    ScheduleExpression: `at(${at})`,
    ScheduleExpressionTimezone: "UTC",
    FlexibleTimeWindow: { Mode: "OFF" },
    Description: input.description,
    Target: {
      Arn: input.targetLambdaArn,
      RoleArn: input.roleArn,
      Input: JSON.stringify(input.payload),
    },
    ActionAfterCompletion: "DELETE", // one-shot: scheduler auto-cleans
  };

  try {
    await schedulerClient().send(new CreateScheduleCommand(cmdInput));
  } catch (e) {
    const err = e as { name?: string };
    if (err.name === "ConflictException") {
      // Schedule already exists — delete and recreate.
      await deleteSchedule(input.name, input.groupName);
      await schedulerClient().send(new CreateScheduleCommand(cmdInput));
      return;
    }
    throw e;
  }
}

/** Deletes a schedule by name; silently ignores ResourceNotFoundException. */
export async function deleteSchedule(name: string, groupName?: string): Promise<void> {
  try {
    await schedulerClient().send(
      new DeleteScheduleCommand({
        Name: name,
        GroupName: groupName ?? defaultGroup(),
      }),
    );
  } catch (e) {
    if ((e as { name?: string }).name === "ResourceNotFoundException") return;
    throw e;
  }
}

/**
 * Deletes every schedule whose name starts with the given prefix
 * (e.g. `inv-abc123-` nukes all 8 per-invoice stages at once).
 */
export async function deleteSchedulesByPrefix(
  prefix: string,
  groupName?: string,
): Promise<number> {
  let deleted = 0;
  let nextToken: string | undefined;
  do {
    const res = await schedulerClient().send(
      new ListSchedulesCommand({
        GroupName: groupName ?? defaultGroup(),
        NamePrefix: prefix,
        NextToken: nextToken,
      }),
    );
    for (const s of res.Schedules ?? []) {
      if (!s.Name) continue;
      await deleteSchedule(s.Name, groupName);
      deleted++;
    }
    nextToken = res.NextToken;
  } while (nextToken);
  return deleted;
}
