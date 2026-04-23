import { describe, expect, it } from "../helpers/test-shim.js";
import {
  buildGrnPurchaseVoucherXml,
  buildDcVoucherXml,
  type TallyLedgerMap,
  type TallyLineItem,
} from "../../shared/tally.js";

const LEDGERS: TallyLedgerMap = {
  purchaseLedgerName: "Purchase Accounts",
  salesLedgerName: "Sales Accounts",
  cgstLedgerName: "CGST 9%",
  sgstLedgerName: "SGST 9%",
  igstLedgerName: "IGST 18%",
  vendorTallyNameMap: { "vendor-1": "Acme Traders Pvt Ltd" },
  clientTallyNameMap: { "client-1": "Beta Corp" },
};

const ITEMS: TallyLineItem[] = [
  {
    productName: "LG 55UR640S Signage Display",
    modelNumber: "55UR640S",
    hsnTallyFormat: "85287200",
    unitCount: 2,
    unitPriceInr: 45000,
    gstRatePercent: 18,
  },
  {
    productName: "HDMI 2.0 Cable 5m",
    hsnTallyFormat: "85447000",
    unitCount: 4,
    unitPriceInr: 800,
    gstRatePercent: 18,
  },
];

describe("GRN → Purchase Voucher XML", () => {
  it("emits well-formed XML for an intrastate GRN", () => {
    const xml = buildGrnPurchaseVoucherXml(
      {
        voucherDate: new Date("2025-06-15T00:00:00Z"),
        grnNumber: "GRN-2526-00001",
        vendorId: "vendor-1",
        lineItems: ITEMS,
        intrastate: true,
        narration: "Test GRN",
      },
      LEDGERS,
    );
    expect(xml).toContain('<VOUCHER VCHTYPE="Purchase"');
    expect(xml).toContain("<VOUCHERNUMBER>GRN-2526-00001</VOUCHERNUMBER>");
    expect(xml).toContain("<PARTYLEDGERNAME>Acme Traders Pvt Ltd</PARTYLEDGERNAME>");
    expect(xml).toContain("<HSNCODE>85287200</HSNCODE>");
    expect(xml).toContain("CGST 9%");
    expect(xml).toContain("SGST 9%");
    expect(xml).not.toContain("IGST 18%");
  });

  it("uses IGST ledger for interstate GRN", () => {
    const xml = buildGrnPurchaseVoucherXml(
      {
        voucherDate: new Date("2025-06-15T00:00:00Z"),
        grnNumber: "GRN-2526-00002",
        vendorId: "vendor-1",
        lineItems: ITEMS,
        intrastate: false,
      },
      LEDGERS,
    );
    expect(xml).toContain("IGST 18%");
    expect(xml).not.toContain("CGST 9%");
  });

  it("blocks export if Tally ledger mapping is missing for the vendor", () => {
    expect(() =>
      buildGrnPurchaseVoucherXml(
        {
          voucherDate: new Date(),
          grnNumber: "GRN-2526-00003",
          vendorId: "unknown-vendor",
          lineItems: ITEMS,
          intrastate: true,
        },
        LEDGERS,
      ),
    ).toThrow(/Tally ledger name mapped for vendor/);
  });

  it("blocks export if an HSN code is Tally-incompatible", () => {
    expect(() =>
      buildGrnPurchaseVoucherXml(
        {
          voucherDate: new Date(),
          grnNumber: "GRN-2526-00004",
          vendorId: "vendor-1",
          lineItems: [{ ...ITEMS[0]!, hsnTallyFormat: "ABCD" }],
          intrastate: true,
        },
        LEDGERS,
      ),
    ).toThrow(/Tally-incompatible HSN/);
  });

  it("escapes XML special chars in narration and product names", () => {
    const xml = buildGrnPurchaseVoucherXml(
      {
        voucherDate: new Date(),
        grnNumber: "GRN-2526-00005",
        vendorId: "vendor-1",
        lineItems: [{ ...ITEMS[0]!, productName: "55\" Display & Mount <L>" }],
        intrastate: true,
        narration: 'He said "hi" & left',
      },
      LEDGERS,
    );
    expect(xml).toContain("&quot;hi&quot;");
    expect(xml).toContain("&amp;");
    expect(xml).toContain("&lt;L&gt;");
  });
});

describe("DC → Sales Voucher XML", () => {
  it("emits a Sales voucher with client ledger", () => {
    const xml = buildDcVoucherXml(
      {
        voucherDate: new Date("2025-06-20T00:00:00Z"),
        dcNumber: "DC-2526-00001",
        clientId: "client-1",
        lineItems: ITEMS,
        intrastate: true,
        voucherType: "Sales",
      },
      LEDGERS,
    );
    expect(xml).toContain('<VOUCHER VCHTYPE="Sales"');
    expect(xml).toContain("<PARTYLEDGERNAME>Beta Corp</PARTYLEDGERNAME>");
    expect(xml).toContain("Sales Accounts");
  });

  it("emits a plain Delivery Note (no ledger impact)", () => {
    const xml = buildDcVoucherXml(
      {
        voucherDate: new Date("2025-06-20T00:00:00Z"),
        dcNumber: "DC-2526-00002",
        clientId: "client-1",
        lineItems: ITEMS,
        intrastate: true,
        voucherType: "Delivery Note",
      },
      LEDGERS,
    );
    expect(xml).toContain('<VOUCHER VCHTYPE="Delivery Note"');
    expect(xml).not.toContain("Sales Accounts");
    expect(xml).not.toContain("CGST");
  });
});

