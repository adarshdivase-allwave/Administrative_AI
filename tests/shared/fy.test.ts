import { describe, expect, it } from "../helpers/test-shim.js";
import {
  fyStartYear,
  fyLabel,
  fyShort,
  fyStartDate,
  fyEndDate,
  isSameFY,
  daysBetween,
  tdsDueDateForMonth,
  isFyRolloverDay,
} from "../../shared/fy.js";

// Helper: construct a Date at a specific IST moment. The test machine TZ may
// differ from IST, so we use `Date.UTC` with an IST offset of +05:30.
const IST = (y: number, m: number, d: number, h = 12, min = 0) =>
  new Date(Date.UTC(y, m, d, h - 5, min - 30));

describe("FY helpers", () => {
  it("fyStartYear: March 31 IST → previous FY", () => {
    expect(fyStartYear(IST(2026, 2, 31, 23, 59))).toBe(2025);
  });

  it("fyStartYear: April 1 IST → new FY", () => {
    expect(fyStartYear(IST(2026, 3, 1, 0, 1))).toBe(2026);
  });

  it("fyStartYear: mid-FY", () => {
    expect(fyStartYear(IST(2025, 10, 15))).toBe(2025);
    expect(fyStartYear(IST(2026, 0, 15))).toBe(2025);
  });

  it("fyLabel: formats correctly", () => {
    expect(fyLabel(IST(2025, 5, 1))).toBe("FY 2025-26");
    expect(fyLabel(IST(2026, 2, 31))).toBe("FY 2025-26");
    expect(fyLabel(IST(2099, 5, 1))).toBe("FY 2099-00");
  });

  it("fyShort: 4-digit format used in numbering", () => {
    expect(fyShort(IST(2025, 5, 1))).toBe("2526");
    expect(fyShort(IST(2026, 5, 1))).toBe("2627");
    expect(fyShort(IST(2099, 5, 1))).toBe("9900");
  });

  it("fyStartDate: exact April 1 00:00 IST", () => {
    const start = fyStartDate(IST(2025, 11, 15));
    // Equivalent to April 1 2025 00:00 IST = March 31 2025 18:30 UTC
    expect(start.toISOString()).toBe("2025-03-31T18:30:00.000Z");
  });

  it("fyEndDate: March 31 23:59:59.999 IST", () => {
    const end = fyEndDate(IST(2025, 5, 1));
    expect(end.toISOString()).toBe("2026-03-31T18:29:59.999Z");
  });

  it("isSameFY: handles FY boundary correctly", () => {
    expect(isSameFY(IST(2025, 3, 1), IST(2026, 2, 31))).toBe(true);
    expect(isSameFY(IST(2026, 2, 31), IST(2026, 3, 1))).toBe(false);
  });

  it("daysBetween: IST calendar days", () => {
    expect(daysBetween(IST(2025, 3, 1), IST(2025, 3, 8))).toBe(7);
    expect(daysBetween(IST(2025, 3, 8), IST(2025, 3, 1))).toBe(-7);
  });

  it("tdsDueDateForMonth: 7th of next month", () => {
    // Deductions in April 2025 → due 7th May 2025
    const due = tdsDueDateForMonth(2025, 3);
    expect(due.toISOString().slice(0, 10)).toBe("2025-05-07");
  });

  it("isFyRolloverDay: April 1 IST", () => {
    expect(isFyRolloverDay(IST(2026, 3, 1, 0, 1))).toBe(true);
    expect(isFyRolloverDay(IST(2026, 3, 1, 23, 59))).toBe(true);
    expect(isFyRolloverDay(IST(2026, 2, 31, 23, 59))).toBe(false);
    expect(isFyRolloverDay(IST(2026, 3, 2, 0, 0))).toBe(false);
  });
});

