/**
 * Depreciation calculations for fixed assets (UnitRecord.inventoryCategory = ASSET).
 *
 * Two supported methods:
 *   - STRAIGHT_LINE: (cost − salvage) / usefulLifeYears  — equal amount per year.
 *   - DECLINING_BALANCE: currentBookValue × (2 / usefulLifeYears)  — double-declining.
 *
 * Depreciation runs monthly (1st of every month, IST) via `depreciation-engine`
 * Lambda; each run produces (annualDepreciation / 12) for STRAIGHT_LINE and a
 * pro-rated month value for DECLINING_BALANCE, never taking book value below
 * salvage value.
 */
import type { DepreciationModel } from "./constants.js";
import { daysBetween, fyStartYear } from "./fy.js";

export interface DepreciationInput {
  cost: number;
  salvageValue: number;
  usefulLifeYears: number;
  purchaseDate: Date;
  currentBookValue: number;
  model: DepreciationModel;
  asOfDate?: Date;
}

export interface DepreciationResult {
  method: DepreciationModel;
  monthlyDepreciation: number;
  newBookValue: number;
  accumulatedDepreciation: number;
  hasReachedSalvage: boolean;
  ageInMonths: number;
}

/** Computes one month's depreciation for a unit; returns the updated book value. */
export function computeMonthlyDepreciation(input: DepreciationInput): DepreciationResult {
  const { cost, salvageValue, usefulLifeYears, purchaseDate, currentBookValue, model } = input;
  const asOf = input.asOfDate ?? new Date();

  if (usefulLifeYears <= 0 || cost <= salvageValue || currentBookValue <= salvageValue) {
    return {
      method: model,
      monthlyDepreciation: 0,
      newBookValue: Math.max(currentBookValue, salvageValue),
      accumulatedDepreciation: cost - Math.max(currentBookValue, salvageValue),
      hasReachedSalvage: currentBookValue <= salvageValue,
      ageInMonths: Math.floor(daysBetween(purchaseDate, asOf) / 30),
    };
  }

  const ageInMonths = Math.floor(daysBetween(purchaseDate, asOf) / 30);

  let monthly = 0;
  if (model === "STRAIGHT_LINE") {
    monthly = (cost - salvageValue) / (usefulLifeYears * 12);
  } else {
    // Double declining balance: 2x the straight-line rate applied to book value.
    const annualRate = 2 / usefulLifeYears;
    monthly = (currentBookValue * annualRate) / 12;
  }

  let newBook = currentBookValue - monthly;
  let hasReachedSalvage = false;
  if (newBook < salvageValue) {
    monthly = currentBookValue - salvageValue;
    newBook = salvageValue;
    hasReachedSalvage = true;
  }

  const round2 = (n: number) => Math.round(n * 100) / 100;
  return {
    method: model,
    monthlyDepreciation: round2(monthly),
    newBookValue: round2(newBook),
    accumulatedDepreciation: round2(cost - newBook),
    hasReachedSalvage,
    ageInMonths,
  };
}

/** Useful for FY-wise reports: total depreciation for one unit during the FY containing `asOfDate`. */
export function fyDepreciationEstimate(
  input: DepreciationInput,
): { fyStartYear: number; annualDepreciation: number } {
  const startYear = fyStartYear(input.asOfDate ?? new Date());
  if (input.model === "STRAIGHT_LINE") {
    return {
      fyStartYear: startYear,
      annualDepreciation: (input.cost - input.salvageValue) / input.usefulLifeYears,
    };
  }
  const annualRate = 2 / input.usefulLifeYears;
  return {
    fyStartYear: startYear,
    annualDepreciation: input.currentBookValue * annualRate,
  };
}
