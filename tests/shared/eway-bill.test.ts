import { describe, expect, it } from "../helpers/test-shim.js";
import {
  checkEWayBillRequirement,
  validateEWayBillForDc,
} from "../../shared/eway-bill.js";

describe("e-Way Bill threshold", () => {
  it("required at exactly the threshold", () => {
    expect(checkEWayBillRequirement(50_000).required).toBe(true);
  });

  it("not required below threshold", () => {
    expect(checkEWayBillRequirement(49_999).required).toBe(false);
  });

  it("respects custom threshold (state override)", () => {
    expect(checkEWayBillRequirement(100_000, 200_000).required).toBe(false);
    expect(checkEWayBillRequirement(250_000, 200_000).required).toBe(true);
  });
});

describe("DC e-Way Bill validation", () => {
  it("allows DC below threshold without an EWB", () => {
    const r = validateEWayBillForDc({ totalValueInr: 10_000 });
    expect(r.ok).toBe(true);
  });

  it("blocks DC ≥ threshold without EWB", () => {
    const r = validateEWayBillForDc({ totalValueInr: 100_000 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/mandatory/i);
  });

  it("blocks malformed EWB number", () => {
    const r = validateEWayBillForDc({
      totalValueInr: 100_000,
      eWayBillNumber: "123",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/12 digits/i);
  });

  it("accepts valid 12-digit EWB number ≥ threshold", () => {
    const r = validateEWayBillForDc({
      totalValueInr: 100_000,
      eWayBillNumber: "123456789012",
    });
    expect(r.ok).toBe(true);
  });
});

