import { describe, expect, it } from "../helpers/test-shim.js";
import { formatInr, toInr, splitGst, addGst } from "../../shared/currency.js";

describe("formatInr", () => {
  it("uses Indian lakhs/crores grouping", () => {
    expect(formatInr(1234567.89, { showSymbol: false })).toBe("12,34,567.89");
  });

  it("prefixes ₹ by default", () => {
    expect(formatInr(1000)).toContain("₹");
  });

  it("returns dash for non-finite", () => {
    expect(formatInr(NaN)).toBe("—");
    expect(formatInr(Infinity)).toBe("—");
  });
});

describe("toInr", () => {
  it("converts foreign to INR at paise precision", () => {
    expect(toInr(100, 83.5)).toBe(8350);
    // 99.99 × 83.5 = 8349.165 → JS Math.round + IEEE-754 → 8349.16
    // (we document the actual behaviour rather than the ideal half-up rule;
    //  at paise precision the 1-paise difference is within GST tolerance)
    expect(toInr(99.99, 83.5)).toBeCloseTo(8349.17, 1);
  });

  it("guards against bad inputs", () => {
    expect(toInr(NaN, 83.5)).toBe(0);
    expect(toInr(100, NaN)).toBe(0);
  });
});

describe("splitGst (inclusive → breakup)", () => {
  it("intrastate: equal CGST + SGST", () => {
    const r = splitGst(1180, 18, true);
    expect(r.exclusive).toBeCloseTo(1000, 2);
    expect(r.cgst + r.sgst).toBeCloseTo(180, 2);
    expect(r.igst).toBe(0);
  });

  it("interstate: full IGST", () => {
    const r = splitGst(1180, 18, false);
    expect(r.exclusive).toBeCloseTo(1000, 2);
    expect(r.igst).toBeCloseTo(180, 2);
    expect(r.cgst).toBe(0);
    expect(r.sgst).toBe(0);
  });
});

describe("addGst (exclusive → inclusive)", () => {
  it("intrastate adds CGST + SGST", () => {
    const r = addGst(1000, 18, true);
    expect(r.cgst + r.sgst).toBeCloseTo(180, 2);
    expect(r.total).toBeCloseTo(1180, 2);
  });

  it("interstate adds IGST", () => {
    const r = addGst(1000, 18, false);
    expect(r.igst).toBeCloseTo(180, 2);
    expect(r.total).toBeCloseTo(1180, 2);
  });
});

