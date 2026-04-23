/**
 * Currency helpers. All monetary values in the system are stored in INR as
 * the base currency. Foreign amounts keep their original currency + the
 * forex rate used at conversion time for audit purposes.
 */
import type { Currency } from "./constants.js";

/**
 * Formats a value in INR using Indian grouping (lakhs/crores).
 * e.g. 1234567.89 → "₹ 12,34,567.89"
 */
export function formatInr(amount: number, opts: { showSymbol?: boolean } = {}): string {
  if (!Number.isFinite(amount)) return "—";
  const formatted = new Intl.NumberFormat("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
  return opts.showSymbol === false ? formatted : `₹ ${formatted}`;
}

/**
 * Converts a foreign-currency amount into INR using the provided forex rate.
 * Returns INR paise-precision (2 decimals) — any sub-paise is truncated,
 * because GST reporting disallows fractional paise.
 */
export function toInr(amount: number, rate: number): number {
  if (!Number.isFinite(amount) || !Number.isFinite(rate)) return 0;
  const raw = amount * rate;
  return Math.round(raw * 100) / 100;
}

/**
 * Splits a GST-inclusive price into (exclusive, CGST, SGST, IGST) components.
 * If intrastate: CGST + SGST each at half the rate, IGST = 0.
 * If interstate: IGST at full rate, CGST = SGST = 0.
 */
export function splitGst(
  inclusiveAmount: number,
  gstRatePercent: number,
  intrastate: boolean,
): {
  exclusive: number;
  cgst: number;
  sgst: number;
  igst: number;
  total: number;
} {
  const rate = gstRatePercent / 100;
  const exclusive = Math.round((inclusiveAmount / (1 + rate)) * 100) / 100;
  const totalTax = Math.round((inclusiveAmount - exclusive) * 100) / 100;
  if (intrastate) {
    const cgst = Math.round((totalTax / 2) * 100) / 100;
    const sgst = Math.round((totalTax - cgst) * 100) / 100;
    return { exclusive, cgst, sgst, igst: 0, total: inclusiveAmount };
  }
  return { exclusive, cgst: 0, sgst: 0, igst: totalTax, total: inclusiveAmount };
}

/**
 * Takes an exclusive amount + GST rate and returns the full inclusive breakup.
 * Mirror of `splitGst` for the other input direction (e.g. vendor invoices
 * that list base price + GST separately).
 */
export function addGst(
  exclusiveAmount: number,
  gstRatePercent: number,
  intrastate: boolean,
): {
  exclusive: number;
  cgst: number;
  sgst: number;
  igst: number;
  total: number;
} {
  const tax = Math.round(exclusiveAmount * (gstRatePercent / 100) * 100) / 100;
  if (intrastate) {
    const cgst = Math.round((tax / 2) * 100) / 100;
    const sgst = Math.round((tax - cgst) * 100) / 100;
    return {
      exclusive: exclusiveAmount,
      cgst,
      sgst,
      igst: 0,
      total: Math.round((exclusiveAmount + tax) * 100) / 100,
    };
  }
  return {
    exclusive: exclusiveAmount,
    cgst: 0,
    sgst: 0,
    igst: tax,
    total: Math.round((exclusiveAmount + tax) * 100) / 100,
  };
}

/** Known currency symbols — used only for UI; persistence uses ISO codes. */
export const CURRENCY_SYMBOL: Record<Currency, string> = {
  INR: "₹",
  USD: "$",
  EUR: "€",
  GBP: "£",
};
