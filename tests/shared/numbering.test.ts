import { describe, expect, it } from "../helpers/test-shim.js";
import {
  formatDocNumber,
  parseDocNumber,
  isDocNumberValid,
  padSequence,
  counterKey,
  isEWayBillNumberValid,
  MAX_GST_DOC_LENGTH,
} from "../../shared/numbering.js";

const IST = (y: number, m: number, d: number) => new Date(Date.UTC(y, m, d, 6, 30));

describe("Document numbering", () => {
  it("formats invoice numbers in canonical form", () => {
    expect(formatDocNumber("INVOICE", 1, { fyShortForDate: IST(2025, 5, 1) })).toBe(
      "INV-2526-00001",
    );
    expect(formatDocNumber("DC", 123, { fyShortForDate: IST(2025, 5, 1) })).toBe(
      "DC-2526-00123",
    );
  });

  it("resets sequence on April 1", () => {
    const mar = formatDocNumber("INVOICE", 5000, { fyShortForDate: IST(2026, 2, 31) });
    const apr = formatDocNumber("INVOICE", 1, { fyShortForDate: IST(2026, 3, 1) });
    expect(mar).toBe("INV-2526-05000");
    expect(apr).toBe("INV-2627-00001");
  });

  it("respects the 16-char GST cap", () => {
    const n = formatDocNumber("INVOICE", 1, { fyShortForDate: IST(2025, 5, 1) });
    expect(n.length).toBeLessThanOrEqual(MAX_GST_DOC_LENGTH);
  });

  it("throws on over-length prefixes", () => {
    expect(() =>
      formatDocNumber("INVOICE", 1, {
        prefix: "TOOLONGPREFIX",
        fyShortForDate: IST(2025, 5, 1),
      }),
    ).toThrow(/16/);
  });

  it("expands sequence width when the counter overflows", () => {
    const n = formatDocNumber("INVOICE", 123456, { fyShortForDate: IST(2025, 5, 1) });
    expect(parseDocNumber(n)?.sequence).toBe(123456);
    expect(n.length).toBeLessThanOrEqual(MAX_GST_DOC_LENGTH);
  });

  it("padSequence uses the widest safe width", () => {
    expect(padSequence(5, "INV", "2526", 5)).toBe("00005");
    expect(padSequence(100000, "INV", "2526", 5)).toBe("100000");
  });

  it("parses valid numbers", () => {
    expect(parseDocNumber("INV-2526-00001")).toEqual({
      prefix: "INV",
      fyShort: "2526",
      sequence: 1,
    });
    expect(parseDocNumber("gibberish")).toBeNull();
  });

  it("validates GST doc number characters", () => {
    expect(isDocNumberValid("INV-2526-00001")).toBe(true);
    expect(isDocNumberValid("INV/2526/00001")).toBe(true);
    expect(isDocNumberValid("inv_2526_00001")).toBe(false); // underscores not allowed
    expect(isDocNumberValid("TOO-LONG-NUMBER-12345")).toBe(false);
  });

  it("counterKey is deterministic per (kind, prefix, FY)", () => {
    const k1 = counterKey("INVOICE", "INV", IST(2025, 5, 1));
    const k2 = counterKey("INVOICE", "INV", IST(2026, 0, 15));
    const k3 = counterKey("INVOICE", "INV", IST(2026, 3, 1));
    expect(k1).toBe(k2);
    expect(k1).not.toBe(k3);
    expect(k3).toBe("INVOICE#INV#2627");
  });

  it("isEWayBillNumberValid checks for 12 numeric digits", () => {
    expect(isEWayBillNumberValid("123456789012")).toBe(true);
    expect(isEWayBillNumberValid("12345678901")).toBe(false);
    expect(isEWayBillNumberValid("12345678901A")).toBe(false);
  });
});

