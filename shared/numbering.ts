/**
 * GST-compliant document numbering for invoices, DCs, GRNs, POs.
 *
 * India GST rules (CGST Rule 46):
 *   - Invoice number must be alphanumeric (A–Z, 0–9, hyphens, slashes allowed)
 *   - Maximum 16 characters
 *   - Unique per supplier GSTIN per FY
 *   - Sequential within the FY (resets to 00001 on April 1 each year)
 *
 * Format: `[PREFIX]-[FY-SHORT]-[SEQUENCE]` e.g. `INV-2526-00001`, `DC-2526-00001`
 *
 * Sequence width is 5 digits — supports 99,999 documents per FY per prefix.
 * If any counter exceeds that, the frontend shows a warning and the Lambda
 * widens automatically to 6 digits (still ≤ 16 total chars).
 */
import { fyShort } from "./fy.js";

export const MAX_GST_DOC_LENGTH = 16;
export const ALLOWED_DOC_CHAR_REGEX = /^[A-Z0-9\-/]{1,16}$/;

export type DocumentKind = "INVOICE" | "DC" | "GRN" | "PO";

export interface NumberingConfig {
  prefix: string;
  sequenceWidth: number;
  fyShortForDate?: Date;
}

const DEFAULT_PREFIXES: Record<DocumentKind, string> = {
  INVOICE: "INV",
  DC: "DC",
  GRN: "GRN",
  PO: "PO",
};

export function defaultPrefix(kind: DocumentKind): string {
  return DEFAULT_PREFIXES[kind];
}

/** Zero-pads a sequence number to width, expanding if needed to keep inside 16 chars. */
export function padSequence(seq: number, prefix: string, fy: string, width: number): string {
  const raw = String(seq);
  // PREFIX-FY-SEQ; separators cost 2 chars.
  const headerLen = prefix.length + 1 + fy.length + 1;
  const maxWidth = MAX_GST_DOC_LENGTH - headerLen;
  const effectiveWidth = Math.min(Math.max(width, raw.length), maxWidth);
  return raw.padStart(effectiveWidth, "0");
}

/** Formats a fully-qualified document number. */
export function formatDocNumber(
  kind: DocumentKind,
  sequence: number,
  opts: Partial<NumberingConfig> = {},
): string {
  const prefix = (opts.prefix ?? defaultPrefix(kind)).toUpperCase();
  const fy = fyShort(opts.fyShortForDate ?? new Date());
  const width = opts.sequenceWidth ?? 5;
  const seq = padSequence(sequence, prefix, fy, width);
  const full = `${prefix}-${fy}-${seq}`;
  if (full.length > MAX_GST_DOC_LENGTH) {
    throw new Error(
      `Document number "${full}" exceeds GST max of ${MAX_GST_DOC_LENGTH} chars — shorten prefix.`,
    );
  }
  return full;
}

/** Validates a user-entered document number against GST structural rules. */
export function isDocNumberValid(input: string): boolean {
  if (!input) return false;
  const upper = input.toUpperCase();
  if (upper.length > MAX_GST_DOC_LENGTH) return false;
  return ALLOWED_DOC_CHAR_REGEX.test(upper);
}

/**
 * Parses a doc number of our canonical format and returns its parts.
 * Returns null if the number doesn't conform to our PREFIX-FY-SEQ format
 * (e.g. Admin-overridden manual numbers).
 */
export function parseDocNumber(input: string): {
  prefix: string;
  fyShort: string;
  sequence: number;
} | null {
  const m = /^([A-Z]+)-([0-9]{4})-([0-9]+)$/.exec(input.toUpperCase());
  if (!m) return null;
  return { prefix: m[1]!, fyShort: m[2]!, sequence: parseInt(m[3]!, 10) };
}

/**
 * Builds the partition key used in the `FYSequenceCounter` table.
 * One counter per (prefix, FY) — rolls over automatically when the FY changes.
 */
export function counterKey(kind: DocumentKind, prefix: string, date: Date = new Date()): string {
  return `${kind}#${prefix.toUpperCase()}#${fyShort(date)}`;
}

/**
 * Validates a 12-digit numeric e-Way Bill number (different from doc numbers — stricter).
 */
export const E_WAY_BILL_REGEX = /^[0-9]{12}$/;
export function isEWayBillNumberValid(input: string): boolean {
  return E_WAY_BILL_REGEX.test(input);
}
