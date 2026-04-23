/**
 * EventBridge Scheduler wiring for recurring Lambdas.
 *
 * Cron expressions use `timezone: "Asia/Kolkata"` so IST is the canonical
 * scheduling time across the platform:
 *   - 8 AM IST = daily digest
 *   - 9 AM IST = alert engine
 *   - 1st monthly @ 00:15 IST = TDS bill creation
 *   - 1st monthly @ 01:00 IST = depreciation run
 *   - 1st monthly @ 07:00 IST = warranty expiry digest
 *   - April 1 @ 00:01 IST = FY rollover (counter reset)
 *   - 10:00 IST daily = MSME compliance scan
 *   - 10:30 IST daily = AMC renewal check
 *
 * Per-invoice and per-bill DYNAMIC schedules are NOT created here — the
 * `invoice-scheduler` and `reminder-dispatcher` Lambdas create/delete them
 * at runtime via `@aws-sdk/client-scheduler`.
 */
import { Stack } from "aws-cdk-lib";
import { CfnSchedule, CfnScheduleGroup } from "aws-cdk-lib/aws-scheduler";
import { Role, ServicePrincipal, PolicyStatement } from "aws-cdk-lib/aws-iam";
import type { IFunction } from "aws-cdk-lib/aws-lambda";
import type { MinimalBackend } from "./_backend-types.js";
import { asFn } from "./_backend-types.js";

const SCHEDULED_FN_KEYS = [
  "dailyDigest",
  "alertEngine",
  "depreciationEngine",
  "tdsAutoCreator",
  "warrantyAlertMonthly",
  "fyRollover",
  "msmeComplianceChecker",
  "amcRenewalChecker",
] as const;

export function createEventBridgeSchedules(backend: MinimalBackend): void {
  const appEnv = (process.env.APP_ENV ?? "dev").toLowerCase();
  const stack = Stack.of(backend.data.stack);

  const group = new CfnScheduleGroup(stack, "AvInventoryScheduleGroup", {
    name: `av-inventory-${appEnv}`,
  });

  // Shared scheduler role that can invoke any of the scheduled Lambdas.
  const schedulerRole = new Role(stack, "AvInventorySchedulerRole", {
    assumedBy: new ServicePrincipal("scheduler.amazonaws.com"),
  });

  // Grant InvokeFunction on every scheduled Lambda.
  const fnMap: Record<string, IFunction> = {};
  for (const key of SCHEDULED_FN_KEYS) {
    const fn = asFn(backend, key).resources.lambda;
    fnMap[key] = fn;
    schedulerRole.addToPolicy(
      new PolicyStatement({
        actions: ["lambda:InvokeFunction"],
        resources: [fn.functionArn],
      }),
    );
  }

  const schedules: Array<{
    id: string;
    fnKey: (typeof SCHEDULED_FN_KEYS)[number];
    cron: string;
    description: string;
  }> = [
    { id: "DailyDigest8amIst", fnKey: "dailyDigest", cron: "cron(0 8 * * ? *)", description: "Daily digest 8 AM IST" },
    { id: "AlertEngine9amIst", fnKey: "alertEngine", cron: "cron(0 9 * * ? *)", description: "Alert engine 9 AM IST" },
    { id: "DepreciationMonthly", fnKey: "depreciationEngine", cron: "cron(0 1 1 * ? *)", description: "Depreciation run 1st @ 01:00 IST" },
    { id: "TdsAutoCreator", fnKey: "tdsAutoCreator", cron: "cron(15 0 1 * ? *)", description: "TDS Bill creation 1st @ 00:15 IST" },
    { id: "WarrantyDigest", fnKey: "warrantyAlertMonthly", cron: "cron(0 7 1 * ? *)", description: "Warranty digest 1st @ 07:00 IST" },
    { id: "FyRollover", fnKey: "fyRollover", cron: "cron(1 0 1 4 ? *)", description: "FY rollover Apr 1 @ 00:01 IST" },
    { id: "MsmeDaily", fnKey: "msmeComplianceChecker", cron: "cron(0 10 * * ? *)", description: "MSME compliance scan 10:00 IST" },
    { id: "AmcDaily", fnKey: "amcRenewalChecker", cron: "cron(30 10 * * ? *)", description: "AMC renewal check 10:30 IST" },
  ];

  for (const s of schedules) {
    new CfnSchedule(stack, s.id, {
      name: `${group.name}-${s.id}`,
      description: s.description,
      groupName: group.name,
      flexibleTimeWindow: { mode: "OFF" },
      scheduleExpression: s.cron,
      scheduleExpressionTimezone: "Asia/Kolkata",
      target: {
        arn: fnMap[s.fnKey]!.functionArn,
        roleArn: schedulerRole.roleArn,
      },
    });
  }
}
