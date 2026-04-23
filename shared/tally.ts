/**
 * TallyPrime XML export.
 *
 * Generates `Import Data` envelopes that TallyPrime ingests via the XML import
 * feature (Gateway → Import → Vouchers). We emit two voucher types:
 *
 *   - Purchase Voucher  — from a Goods Received Note (GRN)
 *   - Sales / Delivery Note — from a Delivery Challan (DC)
 *
 * Ledger names are never hard-coded: the caller passes a `TallyLedgerMap`
 * sourced from `SystemSettings`. If any required ledger is missing, the
 * generator throws with a list of missing keys — the Lambda catches that and
 * returns an actionable error to the UI.
 *
 * All amounts are already in INR (base currency). HSN codes are expected to
 * be pre-normalized via `shared/hsn.ts#normalizeHsnForTally`.
 */
import { format as formatDate } from "date-fns";
import { isTallyCompatible } from "./hsn.js";

export interface TallyLedgerMap {
  purchaseLedgerName: string;
  salesLedgerName: string;
  cgstLedgerName: string;
  sgstLedgerName: string;
  igstLedgerName: string;
  /** VendorId → ledger name exactly as it appears in Tally. */
  vendorTallyNameMap: Record<string, string>;
  /** ClientId → ledger name exactly as it appears in Tally. */
  clientTallyNameMap: Record<string, string>;
}

export interface TallyLineItem {
  productName: string;
  modelNumber?: string;
  hsnTallyFormat: string;
  unitCount: number;
  unitPriceInr: number;
  gstRatePercent: number;
}

export interface GrnTallyInput {
  voucherDate: Date;
  grnNumber: string;
  vendorId: string;
  lineItems: TallyLineItem[];
  intrastate: boolean;
  narration?: string;
}

export interface DcTallyInput {
  voucherDate: Date;
  dcNumber: string;
  clientId: string;
  lineItems: TallyLineItem[];
  intrastate: boolean;
  narration?: string;
  /** Sales voucher or plain Delivery Note (no ledger impact). */
  voucherType: "Sales" | "Delivery Note";
}

const XML_HEADER = `<?xml version="1.0" encoding="UTF-8"?>`;

function escapeXml(s: string): string {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function tallyDate(d: Date): string {
  return formatDate(d, "yyyyMMdd");
}

/** Throws with a list of missing ledger fields so the Lambda can surface them. */
function assertLedgers(map: TallyLedgerMap, required: (keyof TallyLedgerMap)[]): void {
  const missing = required.filter((k) => {
    const v = map[k];
    if (typeof v === "string") return v.trim().length === 0;
    return !v || Object.keys(v as object).length === 0;
  });
  if (missing.length) {
    throw new Error(
      `Tally export blocked — missing ledger mappings in System Settings: ${missing.join(", ")}`,
    );
  }
}

function assertHsnTallyCompatible(items: TallyLineItem[]): void {
  const bad = items.filter((i) => !isTallyCompatible(i.hsnTallyFormat));
  if (bad.length) {
    throw new Error(
      `Tally export blocked — ${bad.length} line item(s) have Tally-incompatible HSN codes: ${bad
        .map((b) => `"${b.productName}" (${b.hsnTallyFormat})`)
        .join("; ")}`,
    );
  }
}

// ---------------------------------------------------------------------------

function renderInventoryEntries(items: TallyLineItem[]): string {
  return items
    .map((item) => {
      const total = item.unitPriceInr * item.unitCount;
      const desc = item.modelNumber
        ? `${item.productName} (${item.modelNumber})`
        : item.productName;
      return `
        <ALLINVENTORYENTRIES.LIST>
          <STOCKITEMNAME>${escapeXml(desc)}</STOCKITEMNAME>
          <HSNCODE>${escapeXml(item.hsnTallyFormat)}</HSNCODE>
          <GSTOVRDNTAXRATE>${item.gstRatePercent}</GSTOVRDNTAXRATE>
          <ACTUALQTY>${item.unitCount} Nos</ACTUALQTY>
          <BILLEDQTY>${item.unitCount} Nos</BILLEDQTY>
          <RATE>${item.unitPriceInr.toFixed(2)}/Nos</RATE>
          <AMOUNT>${total.toFixed(2)}</AMOUNT>
        </ALLINVENTORYENTRIES.LIST>`;
    })
    .join("");
}

function computeTaxTotals(items: TallyLineItem[], intrastate: boolean) {
  const base = items.reduce((acc, i) => acc + i.unitPriceInr * i.unitCount, 0);
  const tax = items.reduce(
    (acc, i) => acc + i.unitPriceInr * i.unitCount * (i.gstRatePercent / 100),
    0,
  );
  const total = base + tax;
  if (intrastate) {
    const cgst = tax / 2;
    const sgst = tax - cgst;
    return { base, cgst, sgst, igst: 0, total };
  }
  return { base, cgst: 0, sgst: 0, igst: tax, total };
}

function renderLedgerEntries(
  partyLedgerName: string,
  partySign: "debit" | "credit",
  totals: ReturnType<typeof computeTaxTotals>,
  map: TallyLedgerMap,
  voucherSide: "purchase" | "sales",
): string {
  // Tally uses negative amounts for credits in XML imports.
  const partyAmount = partySign === "credit" ? -totals.total : totals.total;
  const itemLedgerName =
    voucherSide === "purchase" ? map.purchaseLedgerName : map.salesLedgerName;
  const itemSide = voucherSide === "purchase" ? totals.base : -totals.base;

  const entries: string[] = [];
  entries.push(`
        <LEDGERENTRIES.LIST>
          <LEDGERNAME>${escapeXml(partyLedgerName)}</LEDGERNAME>
          <ISDEEMEDPOSITIVE>${partySign === "credit" ? "No" : "Yes"}</ISDEEMEDPOSITIVE>
          <AMOUNT>${partyAmount.toFixed(2)}</AMOUNT>
        </LEDGERENTRIES.LIST>`);
  entries.push(`
        <LEDGERENTRIES.LIST>
          <LEDGERNAME>${escapeXml(itemLedgerName)}</LEDGERNAME>
          <ISDEEMEDPOSITIVE>${voucherSide === "purchase" ? "Yes" : "No"}</ISDEEMEDPOSITIVE>
          <AMOUNT>${itemSide.toFixed(2)}</AMOUNT>
        </LEDGERENTRIES.LIST>`);
  if (totals.cgst > 0) {
    entries.push(`
        <LEDGERENTRIES.LIST>
          <LEDGERNAME>${escapeXml(map.cgstLedgerName)}</LEDGERNAME>
          <ISDEEMEDPOSITIVE>${voucherSide === "purchase" ? "Yes" : "No"}</ISDEEMEDPOSITIVE>
          <AMOUNT>${(voucherSide === "purchase" ? totals.cgst : -totals.cgst).toFixed(2)}</AMOUNT>
        </LEDGERENTRIES.LIST>`);
    entries.push(`
        <LEDGERENTRIES.LIST>
          <LEDGERNAME>${escapeXml(map.sgstLedgerName)}</LEDGERNAME>
          <ISDEEMEDPOSITIVE>${voucherSide === "purchase" ? "Yes" : "No"}</ISDEEMEDPOSITIVE>
          <AMOUNT>${(voucherSide === "purchase" ? totals.sgst : -totals.sgst).toFixed(2)}</AMOUNT>
        </LEDGERENTRIES.LIST>`);
  }
  if (totals.igst > 0) {
    entries.push(`
        <LEDGERENTRIES.LIST>
          <LEDGERNAME>${escapeXml(map.igstLedgerName)}</LEDGERNAME>
          <ISDEEMEDPOSITIVE>${voucherSide === "purchase" ? "Yes" : "No"}</ISDEEMEDPOSITIVE>
          <AMOUNT>${(voucherSide === "purchase" ? totals.igst : -totals.igst).toFixed(2)}</AMOUNT>
        </LEDGERENTRIES.LIST>`);
  }
  return entries.join("");
}

// ---------------------------------------------------------------------------
// Purchase voucher (GRN)
// ---------------------------------------------------------------------------

export function buildGrnPurchaseVoucherXml(input: GrnTallyInput, map: TallyLedgerMap): string {
  assertHsnTallyCompatible(input.lineItems);
  assertLedgers(map, [
    "purchaseLedgerName",
    input.intrastate ? "cgstLedgerName" : "igstLedgerName",
    input.intrastate ? "sgstLedgerName" : "igstLedgerName",
    "vendorTallyNameMap",
  ]);
  const vendorLedger = map.vendorTallyNameMap[input.vendorId];
  if (!vendorLedger) {
    throw new Error(
      `Tally export blocked — no Tally ledger name mapped for vendor "${input.vendorId}". Configure it in System Settings → Tally Integration.`,
    );
  }

  const totals = computeTaxTotals(input.lineItems, input.intrastate);
  const inv = renderInventoryEntries(input.lineItems);
  const led = renderLedgerEntries(vendorLedger, "credit", totals, map, "purchase");

  return `${XML_HEADER}
<ENVELOPE>
  <HEADER>
    <TALLYREQUEST>Import Data</TALLYREQUEST>
  </HEADER>
  <BODY>
    <IMPORTDATA>
      <REQUESTDESC>
        <REPORTNAME>Vouchers</REPORTNAME>
      </REQUESTDESC>
      <REQUESTDATA>
        <TALLYMESSAGE xmlns:UDF="TallyUDF">
          <VOUCHER VCHTYPE="Purchase" ACTION="Create" OBJVIEW="Invoice Voucher View">
            <DATE>${tallyDate(input.voucherDate)}</DATE>
            <VOUCHERNUMBER>${escapeXml(input.grnNumber)}</VOUCHERNUMBER>
            <VOUCHERTYPENAME>Purchase</VOUCHERTYPENAME>
            <PARTYLEDGERNAME>${escapeXml(vendorLedger)}</PARTYLEDGERNAME>
            <NARRATION>${escapeXml(input.narration ?? `GRN ${input.grnNumber}`)}</NARRATION>
            ${led}
            ${inv}
          </VOUCHER>
        </TALLYMESSAGE>
      </REQUESTDATA>
    </IMPORTDATA>
  </BODY>
</ENVELOPE>`.trim();
}

// ---------------------------------------------------------------------------
// Sales voucher / Delivery Note (DC)
// ---------------------------------------------------------------------------

export function buildDcVoucherXml(input: DcTallyInput, map: TallyLedgerMap): string {
  assertHsnTallyCompatible(input.lineItems);
  const required: (keyof TallyLedgerMap)[] =
    input.voucherType === "Sales"
      ? [
          "salesLedgerName",
          input.intrastate ? "cgstLedgerName" : "igstLedgerName",
          input.intrastate ? "sgstLedgerName" : "igstLedgerName",
          "clientTallyNameMap",
        ]
      : ["clientTallyNameMap"];
  assertLedgers(map, required);
  const clientLedger = map.clientTallyNameMap[input.clientId];
  if (!clientLedger) {
    throw new Error(
      `Tally export blocked — no Tally ledger name mapped for client "${input.clientId}". Configure it in System Settings → Tally Integration.`,
    );
  }

  const totals = computeTaxTotals(input.lineItems, input.intrastate);
  const inv = renderInventoryEntries(input.lineItems);
  const led =
    input.voucherType === "Sales"
      ? renderLedgerEntries(clientLedger, "debit", totals, map, "sales")
      : "";

  return `${XML_HEADER}
<ENVELOPE>
  <HEADER>
    <TALLYREQUEST>Import Data</TALLYREQUEST>
  </HEADER>
  <BODY>
    <IMPORTDATA>
      <REQUESTDESC>
        <REPORTNAME>Vouchers</REPORTNAME>
      </REQUESTDESC>
      <REQUESTDATA>
        <TALLYMESSAGE xmlns:UDF="TallyUDF">
          <VOUCHER VCHTYPE="${input.voucherType}" ACTION="Create" OBJVIEW="Invoice Voucher View">
            <DATE>${tallyDate(input.voucherDate)}</DATE>
            <VOUCHERNUMBER>${escapeXml(input.dcNumber)}</VOUCHERNUMBER>
            <VOUCHERTYPENAME>${input.voucherType}</VOUCHERTYPENAME>
            <PARTYLEDGERNAME>${escapeXml(clientLedger)}</PARTYLEDGERNAME>
            <NARRATION>${escapeXml(input.narration ?? `DC ${input.dcNumber}`)}</NARRATION>
            ${led}
            ${inv}
          </VOUCHER>
        </TALLYMESSAGE>
      </REQUESTDATA>
    </IMPORTDATA>
  </BODY>
</ENVELOPE>`.trim();
}
