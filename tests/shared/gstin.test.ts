import { describe, expect, it } from "../helpers/test-shim.js";
import {
  isGstinFormatValid,
  isGstinChecksumValid,
  validateGstin,
  extractStateCode,
  getStateName,
  isIntrastate,
} from "../../shared/gstin.js";

// GSTINs with truly-valid Mod-36 checksums. Each was computed with the
// GSTN-standard algorithm so we can test the checksum path deterministically.
const VALID_GSTINS = [
  "27AAPFU0939F1ZV", // Maharashtra — documented in GSTN sample
  "29AAACO0148F1ZP", // Karnataka — constructed + checksum-verified
  "07AAACI1195H1ZO", // Delhi — constructed + checksum-verified
];

describe("GSTIN format", () => {
  it("accepts the documented valid GSTINs", () => {
    for (const g of VALID_GSTINS) {
      expect(isGstinFormatValid(g)).toBe(true);
    }
  });

  it("rejects obvious malformations", () => {
    expect(isGstinFormatValid("")).toBe(false);
    expect(isGstinFormatValid("27AAPFU0939F1Z")).toBe(false); // 14 chars
    expect(isGstinFormatValid("27aapfu0939f1zv")).toBe(false); // lowercase
    expect(isGstinFormatValid("27AAPFU0939F1ZVX")).toBe(false); // 16 chars
    expect(isGstinFormatValid("99AAPFU0939F1ZV")).toBe(false); // state code not 0X-3X
    expect(isGstinFormatValid("27AAPFU0939F1YV")).toBe(false); // missing Z at position 13
  });
});

describe("GSTIN checksum", () => {
  it("verifies checksum for known valid GSTINs", () => {
    for (const g of VALID_GSTINS) {
      expect(isGstinChecksumValid(g)).toBe(true);
    }
  });

  it("rejects GSTINs with tampered check digit", () => {
    // Flip the last character of a valid one.
    const bad = "27AAPFU0939F1ZW";
    expect(isGstinFormatValid(bad)).toBe(true);
    expect(isGstinChecksumValid(bad)).toBe(false);
  });
});

describe("validateGstin", () => {
  it("returns full detail on valid input", () => {
    const r = validateGstin("27AAPFU0939F1ZV");
    expect(r.valid).toBe(true);
    expect(r.stateCode).toBe("27");
    expect(r.stateName).toBe("Maharashtra");
  });

  it("surfaces helpful errors on invalid input", () => {
    expect(validateGstin("").error).toMatch(/required/i);
    expect(validateGstin("27AAPFU0939F1ZW").error).toMatch(/checksum/i);
  });

  it("rejects GSTINs that look valid but fail the checksum", () => {
    // These 3 "look right" but their check digit is wrong.
    expect(validateGstin("29AAICA4872A1ZK").valid).toBe(false);
    expect(validateGstin("07AAACH7409R1ZZ").valid).toBe(false);
  });

  it("uppercases input before validation", () => {
    expect(validateGstin("27aapfu0939f1zv").valid).toBe(true);
  });
});

describe("state helpers", () => {
  it("extracts state code from first 2 chars", () => {
    expect(extractStateCode("27AAPFU0939F1ZV")).toBe("27");
    expect(extractStateCode("")).toBeNull();
  });

  it("returns readable state names", () => {
    expect(getStateName("27AAPFU0939F1ZV")).toBe("Maharashtra");
    expect(getStateName("29AAACO0148F1ZP")).toBe("Karnataka");
  });

  it("isIntrastate detects same-state supply (works on format-only match)", () => {
    // Note: isIntrastate only checks state codes, not checksums — callers
    // are expected to have already validated both GSTINs.
    expect(isIntrastate("27AAPFU0939F1ZV", "27AAACH7409R1ZZ")).toBe(true);
    expect(isIntrastate("27AAPFU0939F1ZV", "29AAACO0148F1ZP")).toBe(false);
  });
});

