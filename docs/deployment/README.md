# Deployment Docs — Index

Walk through these in order for a first-time deploy:

1. [**01 — Prerequisites**](./01-prerequisites.md) — AWS account, domain, API keys, MSME, tooling
2. [**02 — First deploy**](./02-first-deploy.md) — end-to-end playbook (~30 min)
3. [**03 — SES production access**](./03-ses-production-access.md) — copy-paste request template
4. [**04 — WAF + security**](./04-waf-and-security.md) — WebACL attachment + security controls
5. [**05 — Tally ledger mapping**](./05-tally-ledger-mapping.md) — how Tally XML export works
6. [**06 — Annual HSN refresh**](./06-annual-hsn-refresh.md) — the Feb/Mar budget-day procedure
7. [**07 — MSME onboarding**](./07-msme-onboarding.md) — MSMED Act 2006 compliance setup
8. [**08 — Lambda reference**](./08-lambda-reference.md) — invoke examples for every on-demand Lambda

Additional assets:
- [`../av-inventory.postman_collection.json`](../av-inventory.postman_collection.json) — Postman collection, all AppSync operations

## Quick links

- **One-page setup checklist** → [`01-prerequisites.md#pre-deploy-checklist`](./01-prerequisites.md#pre-deploy-checklist)
- **I need to rotate a secret** → [`04-waf-and-security.md#secrets-rotation`](./04-waf-and-security.md#secrets-rotation)
- **Tally import rejected my voucher** → [`05-tally-ledger-mapping.md#common-mistakes`](./05-tally-ledger-mapping.md#common-mistakes)
- **GST rates changed — how do I refresh?** → [`06-annual-hsn-refresh.md`](./06-annual-hsn-refresh.md)
- **An MSME notice was sent in error** → [`07-msme-onboarding.md#faq`](./07-msme-onboarding.md#faq)
