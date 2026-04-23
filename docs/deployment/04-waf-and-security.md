# WAF & Security — Production Hardening

## What's enforced at the AWS layer

| Control | Where |
|---|---|
| **AppSync authentication** | Cognito User Pool, 4 groups with per-model access rules |
| **Field-level financial restrictions** | Admin-only `@auth` rules on purchasePrice, bookValue, analytics |
| **Rate limiting** | WAF rate-based rule: 100 req / 10s per IP (prod only) |
| **SQL-injection protection** | AWS-managed `AWSManagedRulesSQLiRuleSet` |
| **Common-exploits protection** | AWS-managed `AWSManagedRulesCommonRuleSet` (XSS rules excluded — React escapes) |
| **Known-bad-inputs detection** | AWS-managed `AWSManagedRulesKnownBadInputsRuleSet` |
| **DynamoDB PITR** | Post-synth override on all 36 tables |
| **DynamoDB encryption at rest** | AWS-managed KMS, all 36 tables |
| **Deletion protection** | All 36 tables in prod |
| **S3 encryption** | AES256 SSE on every upload |
| **S3 pre-signed URLs** | 15-min TTL (spec §25) |
| **Secrets Manager** | Gemini + ExchangeRate keys; never in env vars or code |
| **Lambda in VPC** | Outbound internet via NAT Gateway only (configured during prod VPC setup) |
| **Audit log append-only** | No role has `delete` on AuditLog table |
| **Session timeout** | Cognito IdleSessionTTL = 30 min (Admin configurable) |

## WAF WebACL — Attach to Amplify Hosting

The `createWafWebAcl` CDK construct creates a WebACL in scope `CLOUDFRONT`
(required for CloudFront-fronted Amplify Hosting). Dev/staging skip WAF
unless you export `FORCE_WAF=1`.

### Option A — Automatic attachment (preferred)

Before deploy:

```bash
export AMPLIFY_APP_ARN=arn:aws:amplify:ap-south-1:123456789012:apps/abcdefg
APP_ENV=prod npm run deploy:prod
```

The construct creates `CfnWebACLAssociation` automatically.

### Option B — Manual attachment (if ARN unknown at deploy time)

After deploy, read the WebACL ARN from `amplify_outputs.json` → `custom.wafWebAclArn`, then:

```bash
aws wafv2 associate-web-acl \
  --region us-east-1 \
  --web-acl-arn arn:aws:wafv2:us-east-1:123456789012:global/webacl/av-inventory-prod/... \
  --resource-arn arn:aws:amplify:ap-south-1:123456789012:apps/abcdefg
```

## Monitoring WAF

Every rule emits CloudWatch metrics under the `AWS/WAFV2` namespace.

Useful dashboard queries:

```
# Blocked requests in the last 24h by rule
AWS/WAFV2.BlockedRequests
  WebACL=av-inventory-prod
  Region=us-east-1
  GROUP BY Rule

# Rate-limit hits
AWS/WAFV2.AllowedRequests + BlockedRequests
  where Rule=RateLimitPerIp
```

Set a CloudWatch alarm at **blocked requests > 500/5min** — typically indicates
either a credential stuffing attempt or a misconfigured integration.

## Dev/staging behavior

All rules run in `Count` mode (not Block) in dev/staging so CI flakiness
doesn't break local iteration. To test block mode before prod:

```bash
FORCE_WAF=1 APP_ENV=staging ampx sandbox
```

## Excluded CommonRuleSet rules

```typescript
excludedRules: [
  { name: "CrossSiteScripting_BODY" },
  { name: "CrossSiteScripting_QUERYARGUMENTS" },
  { name: "CrossSiteScripting_URIPATH" },
]
```

**Why**: The platform stores rich-text fields (project notes, UnitRecord
damage-photo captions, AuditLog `before`/`after` JSON blobs) that can
legitimately contain `<` and `>` characters. WAF's XSS matcher false-flags
these. React's default JSX escaping at the UI layer + AppSync's native JSON
encoding at the API layer are the correct defense surfaces.

If you need to re-enable XSS rules, remove them from `excludedRules` and
ensure `trimRequestBody: false` is set on AppSync data sources so rich-text
fields aren't stripped on the way in.

## Secrets rotation

| Secret | Rotation cadence | Procedure |
|---|---|---|
| Gemini API key | 90 days | Regenerate in AI Studio → update Secrets Manager → no Lambda restart needed (5-min in-container cache auto-refreshes) |
| ExchangeRate-API key | 365 days | Same pattern |
| Cognito user passwords | Forced via policy: 90-day expiry | Cognito handles via password policy |

## Audit log integrity

The `AuditLog` table's IAM policy explicitly lacks `dynamodb:DeleteItem` for
all roles (including Admin). Attempts to delete a row will fail with an
authorization error. If you ever need to purge logs (GDPR-style request),
the procedure is:

1. Export the log region to cold storage (S3 + Glacier)
2. Drop the table via CloudFormation `DeletionProtection: false` → redeploy
   with fresh empty table
3. Document the deletion in a new audit row

This is intentionally inconvenient to discourage tampering.
