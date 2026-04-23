# AV Integration Inventory & Operations Management Platform

**Version 5.0 — Backend (Amplify Gen 2)**
**Region:** `ap-south-1` (Mumbai) — India FY, GST, MSMED Act 2006, TallyPrime, e-Way Bill compliant.

This repository contains **only the backend** (AWS Amplify Gen 2 CDK + Lambdas + SES templates + seed scripts). The React/Vite/PWA frontend is a separate deliverable and is not included.

---

## Project layout

```
.
├── amplify/
│   ├── backend.ts                    # Amplify Gen 2 backend entry
│   ├── auth/resource.ts              # Cognito user pool (4 groups, 30-min idle TTL)
│   ├── data/resource.ts              # AppSync GraphQL schema + 36 DynamoDB tables
│   ├── storage/resource.ts           # S3 private + public buckets
│   ├── functions/                    # 17 Lambda functions (see below)
│   └── custom/                       # CDK constructs: EventBridge, Secrets, SES, OpenSearch, WAF
├── shared/                           # Pure TS utilities (FY, GSTIN, HSN, numbering, Tally XML)
├── scripts/                          # Seed, FY-rollover test, PITR verification
├── ses-templates/                    # 22 SES HTML email templates
├── tests/                            # Vitest unit tests
├── .env.example                      # Copy to .env.dev / .env.staging / .env.prod
├── package.json
└── tsconfig.json
```

## Lambda functions (17 total)

**13 primary:**
`alert-engine`, `reminder-dispatcher`, `invoice-scheduler`, `payment-reminder-sender`, `msme-compliance-checker`, `invoice-confirmation-scheduler`, `daily-digest`, `depreciation-engine`, `hsn-validator`, `boq-parser`, `chatbot-handler`, `tally-export-generator`, `forex-rate-fetcher`.

**4 scheduled:**
`fy-rollover` (Apr 1 00:01 IST), `tds-auto-creator` (1st monthly), `warranty-alert-monthly` (1st monthly), `amc-renewal-checker` (daily).

## DynamoDB tables (36 total, all with PITR + encryption + deletion protection)

`ProductMaster`, `UnitRecord` (8 GSIs), `GoodsReceivedNote`, `DeliveryChallan`, `DispatchLineItem`, `ReturnRecord`, `TransferOrder`, `DemoRecord`, `ServiceTicket`, `AMCContract`, `Godown`, `ClientInvoice`, `PaymentReminderLog`, `MSMEComplianceLog`, `InvoiceConfirmation`, `Bill`, `BillReminderLog`, `PurchaseOrder`, `POLineItem`, `BOQUpload`, `StockAlert`, `Reminder`, `ReminderLog`, `AuditLog`, `Vendor`, `Client`, `Project`, `HSNDatabase`, `Comment`, `ActivityFeed`, `ChatSession`, `ClientPortalToken`, `DepreciationRecord`, `SystemSettings`, `ForexRateCache`, `FYSequenceCounter`.

---

## Operator documentation

For deploy, SES production access, WAF attachment, Tally ledger mapping,
MSME onboarding, annual HSN refresh, and Lambda invocation examples, see
**[`docs/deployment/`](./docs/deployment/README.md)**.

A Postman collection for all on-demand AppSync operations is at
[`docs/av-inventory.postman_collection.json`](./docs/av-inventory.postman_collection.json).

## Prerequisites (before you can `ampx sandbox` or deploy to prod)

### 1. AWS

- AWS account with billing enabled
- IAM user / role with `AdministratorAccess-Amplify` (or scoped equivalent)
- AWS CLI v2 configured: `aws configure --profile av-inventory-dev`
- Region set to `ap-south-1`

### 2. Domain + SES

- A domain you control (e.g. `yourco.in`)
- SES **domain identity** verified (add TXT + DKIM CNAME records)
- SPF + DMARC records published
- SES **production access** granted (submit request via AWS console — the account starts in sandbox, which only sends to verified addresses)

### 3. External API keys (stored in AWS Secrets Manager after provisioning)

- **Google Gemini 1.5 Pro** — get API key from https://aistudio.google.com/apikey
- **ExchangeRate-API** — free tier at https://www.exchangerate-api.com (1500 req/month)

### 4. MSMED Act 2006 (India compliance)

- Udyam Registration Number (UAM/URN from https://udyamregistration.gov.in)
- MSME certificate PDF (will be uploaded to private S3 during System Settings step)

### 5. Company details

- GSTIN (15-char, validated against regex)
- Company legal name + billing address
- Tally ledger name mappings (Purchase Ledger, Sales Ledger, CGST / SGST / IGST ledgers, vendor-name-as-in-Tally dictionary)

### 6. Node tooling

- Node.js **20.x LTS**
- npm 10+

---

## Local setup

```bash
# Install
npm install

# Copy env template and fill values (but keep API keys in Secrets Manager)
cp .env.example .env.dev

# Run tests (pure logic, no AWS needed)
npm test

# Typecheck everything
npm run typecheck
```

## Deploying

### Dev sandbox (your personal AWS account)

```bash
npm run sandbox
# Watches amplify/ and live-reloads changes to your sandbox stack.
# Produces amplify_outputs.json which the frontend consumes.
```

### Staging + Prod

```bash
# One-time: connect this repo to AWS Amplify Hosting via the console.
# Configure three branches: dev, staging, prod.
# Each branch gets its own Amplify app + isolated DynamoDB tables.
npm run deploy:prod
```

### First-time provisioning after deploy

1. Upload MSME certificate PDF to the private S3 bucket (path: `msme/certificate.pdf`) and record the S3 key in `SystemSettings`.
2. Seed HSN database into OpenSearch: `npm run seed:hsn` (requires `OPENSEARCH_COLLECTION_ENDPOINT` in `.env`).
3. Seed sample data (optional, dev only): `npm run seed:samples`.
4. Create Gemini + ExchangeRate secrets in Secrets Manager:
   ```bash
   aws secretsmanager create-secret --name av-inventory/gemini-api-key --secret-string '{"apiKey":"..."}'
   aws secretsmanager create-secret --name av-inventory/exchangerate-api-key --secret-string '{"apiKey":"..."}'
   ```
5. In the AWS SES console, move the 22 email templates from sandbox to production sending.
6. Verify PITR on all 36 tables: `npm run verify:pitr`.

---

## India compliance cheatsheet

| Rule | Where enforced |
|---|---|
| FY = April 1 → March 31 | `shared/fy.ts` + `fy-rollover` Lambda |
| GST invoice # ≤ 16 alphanumeric, FY sequential | `shared/numbering.ts` + `FYSequenceCounter` table |
| GSTIN 15-char regex + state code | `shared/gstin.ts` |
| e-Way Bill mandatory ≥ ₹50,000 | `shared/eway-bill.ts` + DC mutation resolver |
| HSN 4/6/8-digit, SAC 6-digit starting 99 | `shared/hsn.ts` |
| Tally XML normalization | `shared/tally.ts` + `tally-export-generator` Lambda |
| TDS deposit 7th of month | `tds-auto-creator` Lambda + `Bill` table |
| MSME 45-day auto-notice | `msme-compliance-checker` Lambda |
| Depreciation monthly (SLM / DB) | `depreciation-engine` Lambda |
| Daily alerts 9 AM IST | `alert-engine` Lambda + EventBridge |
| Daily digest 8 AM IST | `daily-digest` Lambda + EventBridge |

---

## Annual HSN refresh (every April)

India's GST council revises HSN rates occasionally. To refresh:

```bash
# 1. Download latest HSN schedule from CBIC (CSV) into scripts/data/hsn-raw.csv
# 2. Run the seed script with the --upsert flag
npm run seed:hsn -- --upsert
```

This re-indexes every row in the OpenSearch `hsn-india-gst` index and bumps `ProductMaster.hsnCodeSource` to `TALLY_VALIDATED` where the code still matches.

---

## Tally ledger mapping guide

Before your first Tally export works, go to **System Settings → Tally Integration** (or seed via `scripts/seed-samples.ts`) and fill:

- `purchaseLedgerName` — e.g. `"Purchase Accounts"`
- `salesLedgerName` — e.g. `"Sales Accounts"`
- `cgstLedgerName`, `sgstLedgerName`, `igstLedgerName`
- `vendorTallyNameMap` — `{ [vendorId]: "Vendor name exactly as it appears in Tally" }`
- `clientTallyNameMap` — same idea for clients

The `tally-export-generator` Lambda refuses to emit XML if any required mapping is missing and returns an actionable error listing every missing ledger/party.

---

## Security posture

- **All 36 DynamoDB tables**: PITR, SSE (AWS-managed KMS), deletion protection (prod only)
- **AppSync `@auth`**: Cognito group directives on every model
- **Financial fields**: Admin-only on `purchasePrice`, `currentBookValue`, analytics aggregates
- **Client Portal**: token-authenticated, no Cognito, no cross-client data, no pricing
- **S3**: private bucket, 15-min pre-signed URLs only; email-assets bucket public (logo only)
- **Lambda**: in VPC, outbound internet only via NAT GW
- **WAF**: rate limit 100 req / 10s per IP, SQL-injection, common-exploits managed rules
- **Audit log**: append-only — no role has `DeleteItem` on `AuditLog`

See `amplify/custom/waf.ts` and `docs/security.md` for exact rules.
