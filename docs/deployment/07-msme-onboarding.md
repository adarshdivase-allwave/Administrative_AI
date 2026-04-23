# MSME Onboarding — Setup Wizard

The platform's MSMED Act 2006 compliance flow is the most legally-sensitive
feature. This doc walks through enabling it correctly.

## Before you start

- [ ] Obtain your **Udyam Registration Number** (format: `UDYAM-<state>-<district>-<7-digit-number>`) from https://udyamregistration.gov.in
- [ ] Download your MSME certificate as a PDF
- [ ] Decide enterprise classification:
  - `MICRO` — investment in plant & machinery ≤ ₹1 crore, turnover ≤ ₹5 crore
  - `SMALL` — investment ≤ ₹10 crore, turnover ≤ ₹50 crore
  - `MEDIUM` — investment ≤ ₹50 crore, turnover ≤ ₹250 crore
- [ ] Identify the Admin user who will approve notices (if enabling the approval gate)

## Step 1 — Upload the certificate

```bash
aws s3 cp msme-certificate.pdf \
  s3://<private-bucket>/msme/certificate.pdf \
  --server-side-encryption AES256
```

Record the S3 key: `msme/certificate.pdf`

## Step 2 — Configure SystemSettings

In the UI: **Admin → System Settings → MSME Compliance**

| Field | Value |
|---|---|
| `msmeEnabled` | `true` |
| `msmeUdyamRegistrationNumber` | Your Udyam number |
| `msmeCertificateS3Key` | `msme/certificate.pdf` |
| `msmeEnterpriseClassification` | `MICRO` / `SMALL` / `MEDIUM` |
| `msmeRequireAdminApproval` | `false` (auto-send) or `true` (Admin gates) |
| `msmeAutoTriggerDays` | `45` (statutory default) — lower only if your signed contracts have shorter agreed terms |

## Step 3 — Verify the SES template

The Lambda uses raw MIME (not the SES template) for the MSME notice because
it attaches the certificate PDF. But it still respects the `SES_FROM_EMAIL`
and `SES_REPLY_TO` env vars.

Test with a safe recipient (yourself):

```bash
# Temporarily add yourself as the client email on a test invoice that's
# > 45 days old in the seed data, then force a manual run:
aws lambda invoke --function-name <msme-compliance-checker-fn> \
  --payload '{"time":"'$(date -u +%Y-%m-%dT%H:%M:%SZ)'"}' \
  /tmp/msme-out.json
```

You should receive:
- Subject: "MSME Act 2006 — Payment notice for Invoice ..."
- Body: statutory notice with company and client details
- Attachment: `MSME-Certificate.pdf`

## Step 4 — Verify the audit trail

Every MSME notice creates:
1. `MSMEComplianceLog` row (invoiceId, sentAt, recipientEmails, template, messageId, certificateAttachedS3Key)
2. `AuditLog` entry (action = `MSME_NOTICE_SENT`, actorRole = `SYSTEM`)
3. `ClientInvoice.status` → `MSME_NOTICE_SENT`
4. `ClientInvoice.msmeNoticeSentAt` timestamp

Query via AppSync (as Admin):

```graphql
query {
  listMSMEComplianceLogs(limit: 100, sortDirection: DESC) {
    items { id invoiceId sentAt daysOverdue recipientEmails sesMessageId }
  }
}
```

## Step 5 — Set up the scheduled run

The `msme-compliance-checker` Lambda already runs daily @ 10:00 IST via the
EventBridge schedule defined in `amplify/custom/eventbridge-schedules.ts`.
No additional wiring needed.

## If the Admin approval gate is enabled

With `msmeRequireAdminApproval = true`:

1. Daily scan finds a qualifying invoice
2. A `StockAlert` row of type `MSME_ADMIN_APPROVAL_REQUEST` is created
3. Admin sees it on the dashboard
4. Admin clicks "Approve" → triggers a second invocation with `forceSend: true` (future iteration — currently the approval UI is a no-op placeholder; the Lambda scaffold is there but the UI hook is not)
5. That second invocation sends the notice and closes out the alert

**Current limitation**: the approval UI is not yet implemented. Until it is, leave `msmeRequireAdminApproval = false` and trust the auto-send path.

## Legal review recommendation

Before your first real MSME notice goes out:

1. Ask your CA or corporate counsel to review the notice template at
   `ses-templates/msme-compliance-notice.html`
2. Confirm the Udyam number on the notice matches your certificate
3. Confirm the attached PDF opens cleanly in Outlook and Gmail
4. Confirm your company's sendas address has SPF + DKIM green in
   `https://dkimvalidator.com` and similar tools

## FAQ

**Q: An MSME notice was sent in error. How do I retract?**

The email can't be retracted — SES won't let you do that. Email the client
manually with an apology and correction. Update the invoice status manually
via the Admin UI to roll back from `MSME_NOTICE_SENT`. A compensating
`MSMEComplianceLog` row (with `retracted: true` in the notes) is on the
roadmap.

**Q: A client disputes the MSME 45-day calculation.**

Check `ClientInvoice.invoiceDate` and `ClientInvoice.paymentTermsDays`. The
Lambda uses `min(msmeAutoTriggerDays, paymentTermsDays)` — if the client's
contract grants 60 days, the notice should NOT have fired. If it did, they
have a valid dispute. Update `paymentTermsDays` on the client's future
invoices to reflect the contract.

**Q: We no longer qualify as MSME (outgrew the classification).**

Set `msmeEnabled = false` in SystemSettings. Existing MSME logs are retained
(audit trail). No new notices will fire.
