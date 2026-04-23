/**
 * GSTIN (Goods & Services Tax Identification Number) helpers.
 *
 * Format: 15 characters
 *   [2-digit state code][10-char PAN][1 entity digit][Z][1 check digit]
 * Example: 27AAPFU0939F1ZV
 *
 * Regex enforces structure; full checksum verification is in `isGstinChecksumValid`.
 */

/** Strict structural regex for GSTIN. */
export const GSTIN_REGEX =
  /^[0-3][0-9][A-Z]{3}[ABCFGHLJPTK][A-Z][0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

/** True iff `input` matches GSTIN structure. Does NOT verify the checksum digit. */
export function isGstinFormatValid(input: string): boolean {
  if (typeof input !== "string") return false;
  return GSTIN_REGEX.test(input);
}

/** India state codes per first 2 digits of GSTIN. */
export const STATE_CODE_TO_NAME: Readonly<Record<string, string>> = {
  "01": "Jammu and Kashmir",
  "02": "Himachal Pradesh",
  "03": "Punjab",
  "04": "Chandigarh",
  "05": "Uttarakhand",
  "06": "Haryana",
  "07": "Delhi",
  "08": "Rajasthan",
  "09": "Uttar Pradesh",
  "10": "Bihar",
  "11": "Sikkim",
  "12": "Arunachal Pradesh",
  "13": "Nagaland",
  "14": "Manipur",
  "15": "Mizoram",
  "16": "Tripura",
  "17": "Meghalaya",
  "18": "Assam",
  "19": "West Bengal",
  "20": "Jharkhand",
  "21": "Odisha",
  "22": "Chhattisgarh",
  "23": "Madhya Pradesh",
  "24": "Gujarat",
  "25": "Daman and Diu", // merged into 26 from 2020; kept for legacy GSTINs
  "26": "Dadra and Nagar Haveli and Daman and Diu",
  "27": "Maharashtra",
  "28": "Andhra Pradesh (Old)",
  "29": "Karnataka",
  "30": "Goa",
  "31": "Lakshadweep",
  "32": "Kerala",
  "33": "Tamil Nadu",
  "34": "Puducherry",
  "35": "Andaman and Nicobar Islands",
  "36": "Telangana",
  "37": "Andhra Pradesh",
  "38": "Ladakh",
  "97": "Other Territory",
  "99": "Centre Jurisdiction",
};

/** Returns the state code (first 2 digits) or null if input is malformed. */
export function extractStateCode(gstin: string): string | null {
  if (!gstin || gstin.length < 2) return null;
  return gstin.slice(0, 2);
}

/** Returns the state name for a GSTIN, or null if state code is unknown. */
export function getStateName(gstin: string): string | null {
  const code = extractStateCode(gstin);
  if (!code) return null;
  return STATE_CODE_TO_NAME[code] ?? null;
}

/**
 * True iff the company and counterparty GSTINs share a state code
 * (i.e. an intrastate supply — CGST + SGST applies, not IGST).
 */
export function isIntrastate(companyGstin: string, counterpartyGstin: string): boolean {
  const a = extractStateCode(companyGstin);
  const b = extractStateCode(counterpartyGstin);
  return Boolean(a && b && a === b);
}

/**
 * GSTIN check-digit verification using the official Mod-36 algorithm
 * (GSTN spec). Returns true iff the 15th character matches.
 *
 * Used as a belt-and-braces check after regex format pass; regex alone
 * catches 99% of typos but some transposition errors slip through.
 */
export function isGstinChecksumValid(gstin: string): boolean {
  if (!isGstinFormatValid(gstin)) return false;
  const codePoint = (c: string) => {
    if (c >= "0" && c <= "9") return c.charCodeAt(0) - "0".charCodeAt(0);
    if (c >= "A" && c <= "Z") return c.charCodeAt(0) - "A".charCodeAt(0) + 10;
    return -1;
  };
  const factor = [1, 2, 1, 2, 1, 2, 1, 2, 1, 2, 1, 2, 1, 2]; // weights for first 14 chars
  let sum = 0;
  for (let i = 0; i < 14; i++) {
    const v = codePoint(gstin[i]!) * factor[i]!;
    sum += Math.floor(v / 36) + (v % 36);
  }
  const checkValue = (36 - (sum % 36)) % 36;
  const expected =
    checkValue < 10
      ? String(checkValue)
      : String.fromCharCode("A".charCodeAt(0) + checkValue - 10);
  return gstin[14] === expected;
}

/** Full validation used by AppSync resolvers + forms: structure + checksum. */
export function validateGstin(gstin: string): {
  valid: boolean;
  stateCode: string | null;
  stateName: string | null;
  error?: string;
} {
  if (!gstin) return { valid: false, stateCode: null, stateName: null, error: "GSTIN required" };
  const upper = gstin.toUpperCase().trim();
  if (!isGstinFormatValid(upper)) {
    return { valid: false, stateCode: null, stateName: null, error: "Invalid GSTIN format" };
  }
  if (!isGstinChecksumValid(upper)) {
    return {
      valid: false,
      stateCode: extractStateCode(upper),
      stateName: getStateName(upper),
      error: "GSTIN checksum failed — please re-check the number",
    };
  }
  return {
    valid: true,
    stateCode: extractStateCode(upper),
    stateName: getStateName(upper),
  };
}
