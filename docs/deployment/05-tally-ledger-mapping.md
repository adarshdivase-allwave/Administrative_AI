# Tally Ledger Mapping Guide

The `tally-export-generator` Lambda refuses to emit XML for a GRN or DC unless
every required Tally ledger is mapped. This guide explains what each ledger
means and how to populate the map.

## The 5 fixed ledgers

Enter these in **Admin → System Settings → Tally Integration**:

| Field | Typical value in Tally | Notes |
|---|---|---|
| `tallyPurchaseLedgerName` | `Purchase Accounts` | Used on every GRN voucher. Must be a ledger under `Purchase Accounts` group. |
| `tallySalesLedgerName` | `Sales Accounts` | Used on every DC-as-Sales voucher. Must be under `Sales Accounts` group. |
| `tallyCgstLedgerName` | `CGST 9%` or `Duties & Taxes — CGST` | Used for intrastate supplies. Must be under `Duties & Taxes` group. |
| `tallySgstLedgerName` | `SGST 9%` or `Duties & Taxes — SGST` | Used for intrastate supplies. |
| `tallyIgstLedgerName` | `IGST 18%` or `Duties & Taxes — IGST` | Used for interstate supplies. |

## Per-counterparty ledger map

Tally uses the **exact ledger name** as the primary key. The inventory
platform uses UUIDs. You need to bridge the two:

```json
{
  "tallyVendorNameMap": {
    "<vendor-uuid-1>": "LG Electronics India Pvt Ltd",
    "<vendor-uuid-2>": "Harman Professional Solutions"
  },
  "tallyClientNameMap": {
    "<client-uuid-1>": "Tata Consultancy Services Limited",
    "<client-uuid-2>": "Reliance Jio Infocomm Limited"
  }
}
```

**Rule**: the string on the right must be byte-for-byte identical to the
ledger name in your Tally company, or Tally's import will reject the voucher
with "Ledger not found".

### How to discover Tally's exact name

1. Open Tally → Chart of Accounts → Ledgers → All Ledgers
2. Find the vendor / client
3. Copy the full name including any trailing period, suffix, or honorific

## Common mistakes

| Error | Cause | Fix |
|---|---|---|
| `Ledger name mapped for vendor` | Missing entry in `tallyVendorNameMap` | Add vendor UUID → ledger name pair |
| `missing ledger mappings in System Settings` | One or more of the 5 fixed ledgers is blank | Fill `tallyCgstLedgerName` etc. |
| Tally-incompatible HSN | HSN has spaces or wrong length | The HSN validator should have caught this during GRN entry; re-validate the product's HSN in the HSN Lookup Tool |
| Tally imports successfully but shows wrong GST amount | GST rate on ProductMaster differs from the rate bundled in your Tally CGST/SGST/IGST ledger | Either fix `gstRatePercent` on the ProductMaster OR point to a differently-rated Tally ledger |

## Testing the map before production use

Before your team starts relying on Tally XML exports:

1. Create a test GRN with a single unit
2. Trigger the export: **GRN detail page → Export for Tally**
3. Download the XML
4. In Tally: Gateway → Import → Vouchers → select the XML file
5. Tally reports success/failure with line-level detail

If Tally rejects the voucher, compare the `<LEDGERNAME>` and `<STOCKITEMNAME>`
strings in the XML against your Tally ledgers.

## Annual updates

When GST rates change (budget day in India is typically February), verify:

- Every `tallyCgstLedgerName` / `tallySgstLedgerName` / `tallyIgstLedgerName`
  still corresponds to the correct rate bucket
- `ProductMaster.gstRatePercent` is updated for affected products
- A fresh `seed-hsn.ts --upsert` run refreshes the HSN database

See [`06-annual-hsn-refresh.md`](./06-annual-hsn-refresh.md).
