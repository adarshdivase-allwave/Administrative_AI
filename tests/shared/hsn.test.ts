import { describe, expect, it } from "../helpers/test-shim.js";
import {
  isHsnFormatValid,
  normalizeHsnForTally,
  isTallyCompatible,
  validateHsn,
} from "../../shared/hsn.js";

describe("HSN format", () => {
  it("accepts 4/6/8 digit HSN", () => {
    expect(isHsnFormatValid("8528")).toBe(true); // Monitors + projectors
    expect(isHsnFormatValid("852872")).toBe(true); // Reception apparatus
    expect(isHsnFormatValid("85287200")).toBe(true); // Fully specified
  });

  it("accepts SAC (6 digits, 99 prefix)", () => {
    expect(isHsnFormatValid("998314")).toBe(true); // IT consulting
    expect(isHsnFormatValid("996311")).toBe(true); // Installation
  });

  it("rejects 5 or 7 digit codes", () => {
    expect(isHsnFormatValid("85287")).toBe(false);
    expect(isHsnFormatValid("8528720")).toBe(false);
  });

  it("rejects non-numeric codes", () => {
    expect(isHsnFormatValid("85AB")).toBe(false);
    expect(isHsnFormatValid("")).toBe(false);
  });
});

describe("Tally normalization", () => {
  it("strips whitespace", () => {
    expect(normalizeHsnForTally(" 85 28 72 ")).toBe("852872");
  });

  it("uppercases input (harmless for all-digit HSN)", () => {
    expect(normalizeHsnForTally("85287200")).toBe("85287200");
  });

  it("isTallyCompatible after normalization", () => {
    expect(isTallyCompatible(" 8528 ")).toBe(true);
    expect(isTallyCompatible("852 87 20 0")).toBe(true);
    expect(isTallyCompatible("ABCD")).toBe(false);
  });
});

describe("validateHsn", () => {
  it("returns tally format on success", () => {
    const r = validateHsn("8528 72 00");
    expect(r.valid).toBe(true);
    expect(r.tallyFormat).toBe("85287200");
    expect(r.isSac).toBe(false);
    expect(r.length).toBe(8);
  });

  it("flags SAC codes", () => {
    const r = validateHsn("998314");
    expect(r.valid).toBe(true);
    expect(r.isSac).toBe(true);
  });

  it("returns error on bad input", () => {
    const r = validateHsn("8528A");
    expect(r.valid).toBe(false);
    expect(r.error).toBeTruthy();
  });
});

