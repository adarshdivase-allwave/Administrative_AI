# Deployment — Prerequisites

Before `ampx sandbox` or any pipeline deploy will succeed, the following must be in place.

## 1. AWS Account

- Billing enabled (DynamoDB, Lambda, Cognito, SES, OpenSearch Serverless, EventBridge Scheduler, WAF all incur charges)
- Target region: **`ap-south-1`** (Mumbai) for India data-residency
  - Exception: WAF for CloudFront-fronted Amplify Hosting **must** live in `us-east-1`
- IAM user with `AdministratorAccess-Amplify` or an equivalent scoped role
- AWS CLI v2 configured: `aws configure --profile av-inventory-<env>`

## 2. Domain + SES

- A domain you control (e.g. `yourco.in`)
- **SES domain identity** verified in `ap-south-1`
  - Add the TXT verification record
  - Add the 3 DKIM CNAME records SES provides
  - Add an SPF TXT: `v=spf1 include:amazonses.com ~all`
  - Recommended DMARC TXT: `v=DMARC1; p=quarantine; rua=mailto:dmarc@yourco.in`
- **SES production sending access** granted
  - By default every new account is in SES sandbox (can only send to verified addresses + ≤ 200 emails/day)
  - Request production access via the AWS console — see [`03-ses-production-access.md`](./03-ses-production-access.md)

## 3. External API keys

| Service | Where to get it | Stored in |
|---|---|---|
| Google Gemini 1.5 Pro | https://aistudio.google.com/apikey | Secrets Manager: `av-inventory/gemini-api-key` |
| ExchangeRate-API | https://www.exchangerate-api.com (free tier: 1500 req/month) | Secrets Manager: `av-inventory/exchangerate-api-key` |

Create each secret **before** first deploy:

```bash
aws secretsmanager create-secret \
  --region ap-south-1 \
  --name av-inventory/gemini-api-key \
  --secret-string '{"apiKey":"AIza..."}'

aws secretsmanager create-secret \
  --region ap-south-1 \
  --name av-inventory/exchangerate-api-key \
  --secret-string '{"apiKey":"..."}'
```

## 4. MSMED Act 2006 (India compliance)

- Udyam Registration Number from https://udyamregistration.gov.in
- MSME certificate PDF (you'll upload to private S3 after first deploy)
- Decide enterprise classification: `MICRO` | `SMALL` | `MEDIUM`

## 5. Company identity

- GSTIN (15-char, regex-validated in the app)
- Legal company name + billing address
- Tally ledger name mappings — see [`05-tally-ledger-mapping.md`](./05-tally-ledger-mapping.md)

## 6. Tooling

- Node.js **20.x LTS**
- npm 10+
- The `ampx` CLI (installed transitively via `@aws-amplify/backend-cli`)

## Pre-deploy checklist

Before running `npm run deploy:prod`, confirm:

- [ ] SES domain identity is in `Verified` status with DKIM + SPF + DMARC live
- [ ] SES production access email received from AWS
- [ ] Both Secrets Manager secrets exist and are readable
- [ ] Udyam Registration Number + MSME certificate PDF in hand
- [ ] Company GSTIN passes the app's checksum validator (test: `npm test -- tests/shared/gstin.test.ts`)
- [ ] Tally ledger name mapping document prepared
- [ ] Amplify Hosting app created and connected to the git repo (for prod branch)
- [ ] `AMPLIFY_APP_ARN` env var exported (optional; enables automatic WAF attachment)
