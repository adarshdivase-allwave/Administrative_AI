# Annual HSN Refresh

The Indian GST Council revises HSN codes and GST rates periodically (typically
at the Union Budget each February). This guide covers how to refresh the
platform's HSN database without downtime.

## When to run

- **Scheduled**: February–March of every calendar year, immediately after the
  Budget session if GST rate changes are announced.
- **Ad-hoc**: Any time CBIC publishes an update notification affecting an HSN
  code your company transacts in.

## Data source

CBIC publishes the full HSN/SAC schedule at:
https://cbic-gst.gov.in/gst-goods-services-rates.html

The spreadsheets are typically PDF or XLS. For the seed script we need CSV
with these columns:

```
hsnCode, description, gstRatePercent, chapter, section, isSac
```

Conversion: open the CBIC XLS, save as CSV, strip any merged-cell header
rows so the first row is the column names.

## Procedure

1. Download the latest CBIC schedule into `scripts/data/hsn-full.csv`
   (gitignored; never commit)
2. Spot-check a few familiar codes (e.g. 85287200 should be 18% for signage
   displays, 996311 should be 18% for installation services)
3. Run the refresh in **upsert** mode:

   ```bash
   APP_ENV=prod npm run seed:hsn -- --file=scripts/data/hsn-full.csv --upsert
   ```

4. Spot-check by searching for a known code in the UI's HSN Lookup Tool
5. Re-run smoke tests on Tally export:

   ```bash
   # Pick a GRN from the last 30 days and re-export to Tally
   # Compare the output vs. the previous export to confirm GST amounts
   # updated correctly if applicable
   ```

## Impact on in-flight records

- `ProductMaster.gstRatePercent` does **not** auto-update. You must manually
  review any product whose HSN code had a rate change. The alert engine
  surfaces mismatches on the dashboard.
- Already-generated invoices, DCs, GRNs use the GST rate that was effective
  at the time they were created — the historical record is preserved by
  design (audit trail).
- Pre-existing `HSNDatabase` rows with the same `hsnCode` are overwritten
  with the new rate; historical lookups route through the invoice/DC
  record's own `hsnTallyFormat` + `gstRatePercent`, not the live database.

## Rollback

If a bad CSV got seeded and broke something:

```bash
# Restore from PITR (within 35 days)
aws dynamodb restore-table-to-point-in-time \
  --region ap-south-1 \
  --source-table-name HSNDatabase-<apiId>-prod \
  --target-table-name HSNDatabase-<apiId>-prod-restore \
  --restore-date-time $(date -u -d "1 hour ago" +%Y-%m-%dT%H:%M:%SZ)

# Re-seed OpenSearch index from the restored table
APP_ENV=prod npm run seed:hsn -- --file=/tmp/restored.csv --upsert
```

## Changelog discipline

After every run, append to `docs/HSN-CHANGELOG.md`:

```
## 2026-04-15 — Budget 2026 refresh
- Updated: 85287200 18% → 18% (no change)
- Updated: 85182100 18% → 12%   <-- action needed for affected Products
- New: 998399 — Other management consulting services
- Products reviewed and updated: LG 55UR640S, JBL IRX112BT
```

Admins referencing this file later will have a paper trail.
