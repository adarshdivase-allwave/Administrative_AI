/**
 * India Financial Year (FY) helpers.
 *
 * FY runs April 1 → March 31. FY label format: "FY 2025-26".
 * Short form used in numbering: "2526".
 *
 * ALL date comparisons happen in Asia/Kolkata to avoid UTC drift causing
 * a transaction created at 23:30 IST on March 31 from being booked into
 * the wrong FY.
 */
import { toZonedTime, fromZonedTime, format as formatTz } from "date-fns-tz";
import { addMonths, endOfDay, startOfDay } from "date-fns";
import { FY_START_MONTH_INDEX, FY_START_DAY, INDIA_TIMEZONE } from "./constants.js";

/** Returns the start year of the FY that contains `date` (IST). */
export function fyStartYear(date: Date = new Date()): number {
  const ist = toZonedTime(date, INDIA_TIMEZONE);
  const year = ist.getFullYear();
  const month = ist.getMonth();
  const day = ist.getDate();
  if (month < FY_START_MONTH_INDEX || (month === FY_START_MONTH_INDEX && day < FY_START_DAY)) {
    return year - 1;
  }
  return year;
}

/** "FY 2025-26" */
export function fyLabel(date: Date = new Date()): string {
  const start = fyStartYear(date);
  const endShort = (start + 1) % 100;
  return `FY ${start}-${String(endShort).padStart(2, "0")}`;
}

/** "2526" — short form for invoice/DC/GRN/PO numbers. */
export function fyShort(date: Date = new Date()): string {
  const start = fyStartYear(date);
  const startShort = start % 100;
  const endShort = (start + 1) % 100;
  return `${String(startShort).padStart(2, "0")}${String(endShort).padStart(2, "0")}`;
}

/** April 1, 00:00 IST of the FY containing `date`. Returned as UTC Date. */
export function fyStartDate(date: Date = new Date()): Date {
  const start = fyStartYear(date);
  const localMidnight = new Date(start, FY_START_MONTH_INDEX, FY_START_DAY, 0, 0, 0, 0);
  return fromZonedTime(localMidnight, INDIA_TIMEZONE);
}

/** March 31, 23:59:59.999 IST of the FY containing `date`. */
export function fyEndDate(date: Date = new Date()): Date {
  const start = fyStartYear(date);
  const localEnd = new Date(start + 1, FY_START_MONTH_INDEX, FY_START_DAY, 0, 0, 0, 0);
  // This is April 1 of next FY — subtract 1 ms to land on March 31 23:59:59.999.
  const ist = fromZonedTime(localEnd, INDIA_TIMEZONE);
  return new Date(ist.getTime() - 1);
}

/** True iff `a` and `b` fall inside the same India FY. */
export function isSameFY(a: Date, b: Date): boolean {
  return fyStartYear(a) === fyStartYear(b);
}

/** Number of days (IST, calendar) `date` is past `fromDate` — negative if before. */
export function daysBetween(fromDate: Date, toDate: Date): number {
  const a = startOfDay(toZonedTime(fromDate, INDIA_TIMEZONE));
  const b = startOfDay(toZonedTime(toDate, INDIA_TIMEZONE));
  const ms = b.getTime() - a.getTime();
  return Math.round(ms / (1000 * 60 * 60 * 24));
}

/** Formats an IST date for display: "01 Apr 2025" */
export function formatIST(date: Date, pattern = "dd MMM yyyy"): string {
  return formatTz(toZonedTime(date, INDIA_TIMEZONE), pattern, { timeZone: INDIA_TIMEZONE });
}

/** Returns the due date of a TDS deposit for a given month — 7th of next month @ 23:59 IST. */
export function tdsDueDateForMonth(year: number, monthIndex: number): Date {
  // monthIndex is the month of the deductions; deposit is due 7th of next month.
  const nextMonth = addMonths(new Date(year, monthIndex, 1), 1);
  const localEnd = new Date(
    nextMonth.getFullYear(),
    nextMonth.getMonth(),
    7,
    23,
    59,
    59,
    999,
  );
  return fromZonedTime(endOfDay(localEnd), INDIA_TIMEZONE);
}

/** Convenience: is this date exactly April 1 IST? (FY rollover boundary) */
export function isFyRolloverDay(date: Date): boolean {
  const ist = toZonedTime(date, INDIA_TIMEZONE);
  return ist.getMonth() === FY_START_MONTH_INDEX && ist.getDate() === FY_START_DAY;
}
