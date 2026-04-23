# Lambda Reference — Invocation Examples

Quick reference for every on-demand Lambda in the platform. For scheduled
Lambdas (alert-engine, daily-digest, etc.) see [`02-first-deploy.md`](./02-first-deploy.md).

All examples assume:

```bash
export AWS_PROFILE=av-inventory-dev
export AWS_REGION=ap-south-1
```

---

## `forex-rate-fetcher`

**Input:** `{ quoteCurrency: "USD" | "EUR" | "GBP", forceRefresh?: boolean }`

```bash
aws lambda invoke --function-name <forex-rate-fetcher> \
  --payload '{"quoteCurrency":"USD"}' \
  --cli-binary-format raw-in-base64-out \
  /tmp/forex.json && cat /tmp/forex.json
```

**Output:**
```json
{
  "baseCurrency": "INR",
  "quoteCurrency": "USD",
  "rate": 83.42,
  "fetchedAt": "2026-04-23T10:30:00Z",
  "expiresAt": "2026-04-23T16:30:00Z",
  "cacheHit": true,
  "source": "cache"
}
```

---

## `hsn-validator`

**Input:** `{ hsnCode?: string, productName?: string, productSpecs?: string }`

```bash
# Validate + look up a specific code
aws lambda invoke --function-name <hsn-validator> \
  --payload '{"hsnCode":"85287200"}' \
  --cli-binary-format raw-in-base64-out \
  /tmp/hsn.json

# Get AI suggestion from product description
aws lambda invoke --function-name <hsn-validator> \
  --payload '{"productName":"55 inch LCD signage display","productSpecs":"LG 55UR640S"}' \
  --cli-binary-format raw-in-base64-out \
  /tmp/hsn.json
```

**Output:**
```json
{
  "status": "VALID" | "INVALID" | "AI_SUGGESTED",
  "hsnCode": "85287200",
  "description": "Television reception apparatus...",
  "gstRatePercent": 18,
  "tallyFormat": "85287200",
  "tallyCompatible": true,
  "isSac": false,
  "sourceUrl": "https://cbic.gov.in/..."  // when AI_SUGGESTED
}
```

---

## `tally-export-generator`

**Input:** `{ kind: "GRN", grnId: string }` **or** `{ kind: "DC", dcId: string, voucherType: "Sales" | "Delivery Note" }`

```bash
aws lambda invoke --function-name <tally-export-generator> \
  --payload '{"kind":"GRN","grnId":"u-sample-grn-001","actorUserId":"u-admin"}' \
  --cli-binary-format raw-in-base64-out \
  /tmp/tally.json
```

**Output:**
```json
{
  "s3Key": "tally-exports/grn/GRN-2526-00001-a1b2c3d4.xml",
  "presignedUrl": "https://...s3.ap-south-1.amazonaws.com/...?X-Amz-Signature=...",
  "xmlSize": 4823,
  "voucherCount": 1,
  "exportedAt": "2026-04-23T11:00:00Z"
}
```

**Error codes** (via `TallyExportError.code`):

| Code | Meaning |
|---|---|
| `SETTINGS_MISSING` | No SystemSettings row — operator hasn't completed first-time setup |
| `GRN_NOT_FOUND` / `DC_NOT_FOUND` | Invalid id |
| `GRN_EMPTY` / `DC_EMPTY` | No line items under the doc |
| `DC_DRAFT` | DC is still in DRAFT status |
| `DC_NO_CLIENT` | DC has no clientId (shouldn't happen via UI flow) |
| `BUCKET_NOT_CONFIGURED` | `PRIVATE_BUCKET_NAME` env var missing |

Plus the Tally-XML builder errors from `shared/tally.ts`:
- `missing ledger mappings in System Settings: ...`
- `no Tally ledger name mapped for vendor ...`
- `Tally-incompatible HSN codes: ...`

---

## `invoice-scheduler`

**Input:** `{ action: "CREATE" | "UPDATE" | "CANCEL", invoiceId: string, actorUserId?: string }`

```bash
aws lambda invoke --function-name <invoice-scheduler> \
  --payload '{"action":"CREATE","invoiceId":"inv-001"}' \
  --cli-binary-format raw-in-base64-out \
  /tmp/sched.json
```

Output confirms how many stages were scheduled (past stages are skipped — a
12-day-old invoice only gets T-7 onwards).

---

## `invoice-confirmation-scheduler`

**Input:** `{ mode: "CREATE" | "FIRE_STAGE" | "CANCEL", invoiceId: string, stage?: "D_3_REQUEST" | "D_7_FOLLOWUP" | "D_10_AUTO_ACCEPTANCE" }`

```bash
# Initial setup on invoice SENT
aws lambda invoke --function-name <invoice-confirmation-scheduler> \
  --payload '{"mode":"CREATE","invoiceId":"inv-001"}' \
  --cli-binary-format raw-in-base64-out \
  /tmp/conf.json
```

Returns `{ action: "created", details: { token: "...", stages: [...] } }`.

---

## `boq-parser`

**Input:** `{ s3Bucket: string, s3Key: string, columnMapping?: {...}, boqUploadId?: string }`

Upload a .xlsx to S3 first, then:

```bash
aws lambda invoke --function-name <boq-parser> \
  --payload '{"s3Bucket":"<private-bucket>","s3Key":"boq-uploads/test.xlsx","boqUploadId":"boq-abc"}' \
  --cli-binary-format raw-in-base64-out \
  /tmp/boq.json
```

**Output:**
```json
{
  "totalLines": 23,
  "matched": 18,
  "unmatched": 5,
  "hsnWarnings": 2,
  "lineItems": [
    {
      "sourceRow": 2,
      "description": "LG 55UR640S Signage Display",
      "quantity": 4,
      "unitRate": 65000,
      "lineTotal": 260000,
      "hsn": "85287200",
      "hsnValid": true,
      "hsnTallyFormat": "85287200",
      "matchedProductId": "p-sample-001",
      "matchedProductName": "LG 55UR640S Signage Display",
      "matchConfidence": 1.0,
      "warnings": []
    }
  ]
}
```

---

## `chatbot-handler`

**Input:** `{ userId: string, message: string, sessionId?: string, deepLinkEntity?: { type, id } }`

```bash
aws lambda invoke --function-name <chatbot-handler> \
  --payload '{"userId":"user-admin","message":"What is the HSN code for a 55-inch signage display?"}' \
  --cli-binary-format raw-in-base64-out \
  /tmp/chat.json
```

**Output:**
```json
{
  "sessionId": "cf1b6d9...",
  "reply": "...",
  "sourceCitations": [
    { "url": "https://cbic.gov.in/...", "title": "HSN Schedule", "domain": "cbic.gov.in" }
  ],
  "tokensUsed": 523,
  "rateLimited": false
}
```

Rate-limited responses return `rateLimited: true` + a friendly message.

---

## `fy-rollover` / `tds-auto-creator` / `depreciation-engine` / `msme-compliance-checker`

These are **scheduled** — never invoke manually except for testing.

For local FY rollover simulation without touching AWS:

```bash
npm run test:fy-rollover
```

For a one-off manual TDS bill creation (useful when onboarding mid-month):

```bash
aws lambda invoke --function-name <tds-auto-creator> \
  --payload '{"time":"'$(date -u -d "first day of this month" +%Y-%m-%dT00:15:00Z)'"}' \
  --cli-binary-format raw-in-base64-out \
  /tmp/tds.json
```

---

## `reminder-dispatcher`

**Input (dual mode):** `{ mode: "SYNC_SCHEDULES" | "FIRE", reminderId: string, op?: "UPSERT" | "DELETE" }`

Called from the AppSync mutation resolver on Reminder CRUD:

```bash
aws lambda invoke --function-name <reminder-dispatcher> \
  --payload '{"mode":"SYNC_SCHEDULES","reminderId":"rem-001","op":"UPSERT"}' \
  --cli-binary-format raw-in-base64-out \
  /tmp/rem.json
```

---

## Debugging checklist

If a Lambda fails:

1. CloudWatch Logs: `/aws/lambda/<function-name>`
2. Check X-Ray if enabled
3. For SES failures, check `SES_FROM_EMAIL` verification status
4. For OpenSearch failures, check the AOSS data-access policy includes the Lambda's execution-role ARN
5. For DynamoDB AccessDenied, grant the specific model in `amplify/data/resource.ts` `allow` rules
