/**
 * tds-auto-creator — runs 1st of every month @ 00:15 IST via EventBridge.
 *
 * Per Indian TDS rules, TDS deducted in month M must be deposited with the
 * government by the 7th of month M+1. This Lambda pre-creates a Bill row on
 * the 1st so the reminder + escalation engine can flag it at D-3 (the 4th)
 * and D-1 (the 6th), and escalate if still not paid by the 7th.
 *
 * Idempotency: uses a deterministic `id` = `TDS-{YYYY-MM}` so re-runs don't
 * duplicate the row.
 */
import type { ScheduledHandler } from "aws-lambda";
import { toZonedTime } from "date-fns-tz";
import { fyLabel, tdsDueDateForMonth, formatIST } from "../../../shared/fy.js";
import { INDIA_TIMEZONE } from "../../../shared/constants.js";
import { putItem, getItem } from "../_lib/ddb.js";
import { writeAudit } from "../_lib/audit.js";

export const handler: ScheduledHandler = async (event) => {
  const runAt = new Date(event.time ?? new Date().toISOString());
  // Convert to IST before deriving month — the schedule fires at 00:15 IST on
  // the 1st, which is 18:45 UTC of the PREVIOUS day. Using UTC directly would
  // put the "this month" computation in the wrong month.
  const ist = toZonedTime(runAt, INDIA_TIMEZONE);
  const monthIndex = ist.getMonth(); // 0-11 in IST
  const year = ist.getFullYear();

  // Month M deductions are due 7th of month M+1.
  // So on 1 May IST we create a bill for April deductions due 7 May.
  const deductionsMonthIndex = (monthIndex + 11) % 12;
  const deductionsYear = monthIndex === 0 ? year - 1 : year;

  const monthNames = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
  ];
  const deductionsMonthName = monthNames[deductionsMonthIndex]!;

  // Due on 7th of the month where `deductionsMonth + 1` falls.
  const dueDate = tdsDueDateForMonth(deductionsYear, deductionsMonthIndex);

  const billId = `TDS-${deductionsYear}-${String(deductionsMonthIndex + 1).padStart(2, "0")}`;

  // Idempotency: skip if already created.
  const existing = await getItem("Bill", { id: billId }).catch(() => undefined);
  if (existing) {
    console.info(`[tds-auto-creator] Bill ${billId} already exists — skipping`);
    return;
  }

  const description = `TDS deposit for ${deductionsMonthName} ${deductionsYear} — due ${formatIST(
    dueDate,
  )}`;

  const now = new Date().toISOString();
  await putItem("Bill", {
    id: billId,
    billType: "TDS",
    description,
    vendorOrAuthority: "Income Tax Department (TDS/TCS)",
    billingCycle: "MONTHLY",
    dueDate: dueDate.toISOString(),
    recurringDayOfMonth: 7,
    reminderDaysBefore: 3,
    assignedToUserId: process.env.ADMIN_USER_ID,
    status: "PENDING",
    fyYear: fyLabel(runAt).replace(/^FY /, ""),
    createdAt: now,
    updatedAt: now,
  });

  await writeAudit({
    actorRole: "SYSTEM",
    action: "TDS_BILL_AUTO_CREATED",
    entityType: "Bill",
    entityId: billId,
    after: { description, dueDate: dueDate.toISOString() },
  });

  console.info(`[tds-auto-creator] Created ${billId}: ${description}`);
};
