/**
 * HSN (Harmonized System Nomenclature) + SAC (Services Accounting Code) helpers.
 *
 * India GST rules:
 *   - HSN codes: 4, 6, or 8 digits (goods)
 *   - SAC codes: 6 digits, must start with "99" (services)
 *   - Both purely numeric
 *
 * Tally normalization strips whitespace and uppercases; TallyPrime XML
 * import is strict and rejects codes with spaces or non-standard length.
 */

/** Valid lengths accepted by India GST for goods HSN codes. */
export const VALID_HSN_LENGTHS = [4, 6, 8] as const;

/** Valid length for SAC (services) — always 6, prefix "99". */
export const SAC_LENGTH = 6;
export const SAC_PREFIX = "99";

/** Strict format check: all-digit, correct length, SAC prefix enforcement. */
export function isHsnFormatValid(code: string): boolean {
  if (typeof code !== "string") return false;
  const trimmed = code.trim();
  if (!/^\d+$/.test(trimmed)) return false;
  const len = trimmed.length;
  if (!VALID_HSN_LENGTHS.includes(len as (typeof VALID_HSN_LENGTHS)[number])) return false;
  if (len === SAC_LENGTH && trimmed.startsWith(SAC_PREFIX)) return true; // SAC
  if ([4, 6, 8].includes(len)) return true; // HSN (6-digit codes NOT starting with 99 are goods)
  return false;
}

/** Normalizes a HSN for TallyPrime ingestion: strips spaces, uppercases (harmless for digits). */
export function normalizeHsnForTally(code: string): string {
  if (!code) return "";
  return code.replace(/\s+/g, "").toUpperCase();
}

/** True iff the normalized form can safely be emitted into a Tally XML voucher. */
export function isTallyCompatible(code: string): boolean {
  const n = normalizeHsnForTally(code);
  return isHsnFormatValid(n);
}

export interface HsnValidationResult {
  valid: boolean;
  tallyFormat: string;
  tallyCompatible: boolean;
  isSac: boolean;
  length: number;
  error?: string;
}

export function validateHsn(code: string): HsnValidationResult {
  if (!code) {
    return {
      valid: false,
      tallyFormat: "",
      tallyCompatible: false,
      isSac: false,
      length: 0,
      error: "HSN/SAC code required",
    };
  }
  const tallyFormat = normalizeHsnForTally(code);
  const valid = isHsnFormatValid(tallyFormat);
  const isSac = tallyFormat.length === SAC_LENGTH && tallyFormat.startsWith(SAC_PREFIX);
  return {
    valid,
    tallyFormat,
    tallyCompatible: valid,
    isSac,
    length: tallyFormat.length,
    error: valid
      ? undefined
      : "HSN must be 4/6/8 digits (SAC: 6 digits starting with 99), numeric only",
  };
}
