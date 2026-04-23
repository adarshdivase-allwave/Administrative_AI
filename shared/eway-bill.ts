/**
 * e-Way Bill threshold logic.
 *
 * Under GST rules, any movement of goods worth ≥ ₹50,000 requires an e-Way Bill
 * generated on the GST portal. Some states have different limits, so the
 * threshold is Admin-configurable (stored in SystemSettings).
 *
 * When a DC total crosses the threshold, the e-Way Bill number becomes mandatory.
 */
import { E_WAY_BILL_THRESHOLD_INR_DEFAULT } from "./constants.js";
import { isEWayBillNumberValid } from "./numbering.js";

export interface EWayBillCheck {
  required: boolean;
  threshold: number;
  totalValue: number;
  message: string;
}

/** Decides whether a DC with `totalValueInr` requires an e-Way Bill. */
export function checkEWayBillRequirement(
  totalValueInr: number,
  threshold: number = E_WAY_BILL_THRESHOLD_INR_DEFAULT,
): EWayBillCheck {
  const required = totalValueInr >= threshold;
  return {
    required,
    threshold,
    totalValue: totalValueInr,
    message: required
      ? `DC value ₹${totalValueInr.toLocaleString(
          "en-IN",
        )} exceeds ₹${threshold.toLocaleString("en-IN")} — e-Way Bill is mandatory under GST rules.`
      : `DC value ₹${totalValueInr.toLocaleString(
          "en-IN",
        )} is below threshold ₹${threshold.toLocaleString("en-IN")} — e-Way Bill optional.`,
  };
}

/**
 * Validates a DC submission against e-Way Bill rules.
 * Call this from the DC save mutation resolver before persisting.
 */
export function validateEWayBillForDc(args: {
  totalValueInr: number;
  eWayBillNumber?: string | null;
  threshold?: number;
}): { ok: true } | { ok: false; error: string } {
  const check = checkEWayBillRequirement(args.totalValueInr, args.threshold);
  if (!check.required) return { ok: true };

  const num = (args.eWayBillNumber ?? "").trim();
  if (!num) {
    return {
      ok: false,
      error: `e-Way Bill number is mandatory: DC value ₹${args.totalValueInr.toLocaleString(
        "en-IN",
      )} ≥ threshold ₹${check.threshold.toLocaleString("en-IN")}.`,
    };
  }
  if (!isEWayBillNumberValid(num)) {
    return {
      ok: false,
      error: "e-Way Bill number must be exactly 12 digits (numeric only).",
    };
  }
  return { ok: true };
}
