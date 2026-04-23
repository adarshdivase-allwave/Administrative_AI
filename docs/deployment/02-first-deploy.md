# Deployment — First Deploy Walkthrough

End-to-end playbook for going from empty AWS account to a running dev environment.
Total time: ~30 min once prerequisites in [`01-prerequisites.md`](./01-prerequisites.md) are ready.

## Step 1 — Local setup

```bash
git clone <your-repo-url> av-inventory
cd av-inventory
npm install
cp .env.example .env.dev
# edit .env.dev with COMPANY_GSTIN, AWS_REGION, APP_ENV=dev etc.
```

Verify everything compiles + all tests pass:

```bash
npx tsc --noEmit
npm test
```

Expect: clean compile, 122 tests pass.

## Step 2 — Configure AWS CLI profile

```bash
aws configure --profile av-inventory-dev
# enter access key, secret, region=ap-south-1, output=json
export AWS_PROFILE=av-inventory-dev
```

## Step 3 — Create Secrets Manager entries

```bash
aws secretsmanager create-secret --region ap-south-1 \
  --name av-inventory/gemini-api-key \
  --secret-string '{"apiKey":"<YOUR_GEMINI_KEY>"}'

aws secretsmanager create-secret --region ap-south-1 \
  --name av-inventory/exchangerate-api-key \
  --secret-string '{"apiKey":"<YOUR_EXCHANGERATE_KEY>"}'
```

## Step 4 — Launch the sandbox

```bash
APP_ENV=dev npm run sandbox
# keep this terminal open; ampx watches amplify/ and live-reloads
```

First run takes ~10 minutes (CloudFormation creates ~60 AWS resources).

On success, `amplify_outputs.json` is written — the frontend consumes this to discover the AppSync endpoint, Cognito pool IDs, and S3 bucket names.

## Step 5 — Verify table hardening

```bash
APP_ENV=dev npm run verify:pitr
```

Expect every DynamoDB table to pass PITR + SSE. `deletionProtection` shows `N/A` in dev (prod-only check).

## Step 6 — Upload MSME certificate

Upload `msme-certificate.pdf` to the private S3 bucket (name is in `amplify_outputs.json`):

```bash
aws s3 cp msme-certificate.pdf s3://<private-bucket>/msme/certificate.pdf
```

## Step 7 — Seed HSN database

```bash
# Default AV-industry starter set (33 rows, enough to test)
npm run seed:hsn

# Or provide the full CBIC CSV
npm run seed:hsn -- --file=/path/to/cbic-hsn-full.csv
```

## Step 8 — (Optional) Seed sample data

```bash
APP_ENV=dev npm run seed:samples
```

Creates 3 godowns + 10 products + 50 units + 5 vendors + 3 clients + 2 projects + 1 TDS bill + 1 SystemSettings row.

**Never run this in prod** — the script aborts if `APP_ENV=prod`.

## Step 9 — Configure System Settings

Log into the frontend and navigate to **Admin → System Settings**.
Update:
- Company identity (name, GSTIN, address, logo)
- Tally ledger map — see [`05-tally-ledger-mapping.md`](./05-tally-ledger-mapping.md)
- MSME toggle + Udyam number + certificate S3 key (already uploaded in step 6)

## Step 10 — Invite users

Via AWS Cognito console (or CLI):

```bash
aws cognito-idp admin-create-user \
  --user-pool-id <pool-id-from-amplify_outputs.json> \
  --username admin@yourco.in \
  --user-attributes Name=email,Value=admin@yourco.in Name=given_name,Value=Admin Name=family_name,Value=User
aws cognito-idp admin-add-user-to-group \
  --user-pool-id <pool-id> \
  --username admin@yourco.in \
  --group-name Admin
```

Repeat for Logistics / Purchase / Sales roles.

## Step 11 — Test the alert engine manually

```bash
aws lambda invoke --function-name <alert-engine-fn-name> \
  --payload '{"time":"'"$(date -u +%Y-%m-%dT%H:%M:%SZ)"'"}' \
  --cli-binary-format raw-in-base64-out \
  /tmp/alert-output.json
cat /tmp/alert-output.json
```

Check `StockAlert` table — you should see rows for any low-stock products in the seed data.

## Step 12 — Test the FY rollover

```bash
npm run test:fy-rollover
```

Local simulation confirms the handler behaves correctly across the March 31 → April 1 boundary. No AWS resources touched.

## Promoting to staging + prod

Once dev is stable:

```bash
# Connect the repo in the Amplify Hosting console, configure staging and prod branches.
# Push to staging:
git push origin staging
# Amplify Hosting auto-deploys.

# For prod:
APP_ENV=prod npm run deploy:prod
```

After prod deploy:
1. `APP_ENV=prod npm run verify:pitr` — confirms deletion-protection is ON
2. Submit the [SES production-access request](./03-ses-production-access.md)
3. Attach the WAF WebACL — see [`04-waf-and-security.md`](./04-waf-and-security.md)
