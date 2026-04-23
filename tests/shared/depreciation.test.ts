import { describe, expect, it } from "../helpers/test-shim.js";
import { computeMonthlyDepreciation } from "../../shared/depreciation.js";

describe("Depreciation — Straight Line", () => {
  it("produces a constant monthly amount", () => {
    const r = computeMonthlyDepreciation({
      cost: 120_000,
      salvageValue: 0,
      usefulLifeYears: 5,
      purchaseDate: new Date("2024-04-01"),
      currentBookValue: 120_000,
      model: "STRAIGHT_LINE",
    });
    expect(r.monthlyDepreciation).toBeCloseTo(2000, 2); // 120k / 60 months
    expect(r.newBookValue).toBeCloseTo(118000, 2);
  });

  it("never goes below salvage value", () => {
    const r = computeMonthlyDepreciation({
      cost: 120_000,
      salvageValue: 10_000,
      usefulLifeYears: 5,
      purchaseDate: new Date("2024-04-01"),
      currentBookValue: 11_000,
      model: "STRAIGHT_LINE",
    });
    expect(r.newBookValue).toBe(10_000);
    expect(r.hasReachedSalvage).toBe(true);
    expect(r.monthlyDepreciation).toBeCloseTo(1000, 2);
  });
});

describe("Depreciation — Declining Balance (double)", () => {
  it("applies 2x straight-line rate to current book value", () => {
    // 2x rate for 5 yr life = 40% annual = ~3.33% monthly.
    const r = computeMonthlyDepreciation({
      cost: 120_000,
      salvageValue: 0,
      usefulLifeYears: 5,
      purchaseDate: new Date("2024-04-01"),
      currentBookValue: 120_000,
      model: "DECLINING_BALANCE",
    });
    expect(r.monthlyDepreciation).toBeCloseTo(4000, 0); // 120000 * 0.4/12 = 4000
    expect(r.newBookValue).toBeCloseTo(116_000, 0);
  });

  it("clamps at salvage value on the last depreciable month", () => {
    const r = computeMonthlyDepreciation({
      cost: 120_000,
      salvageValue: 20_000,
      usefulLifeYears: 5,
      purchaseDate: new Date("2020-04-01"),
      currentBookValue: 20_500,
      model: "DECLINING_BALANCE",
    });
    expect(r.newBookValue).toBe(20_000);
    expect(r.monthlyDepreciation).toBeCloseTo(500, 2);
    expect(r.hasReachedSalvage).toBe(true);
  });
});

