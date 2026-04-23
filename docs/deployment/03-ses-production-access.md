# SES Production Access Request — Template

New AWS accounts start with SES in "sandbox" mode:
- Can only send to verified email addresses
- Daily sending quota: 200 emails
- Per-second rate: 1

Production access lifts these limits. The platform sends ~50–500 emails/day in
steady state, with bursts on the 1st of every month (TDS + bill reminders) and
after large payment-reminder waves. Request at least **10,000/day** to give
MSME + compliance workflows headroom.

## Request procedure

1. AWS Console → SES → **Account dashboard** → **Request production access**
2. Fill in the form using the template below

## Template copy

**Mail type**: Transactional
**Website URL**: `https://inventory.yourco.in`
**Use case description**:

```
Our company is an AV (Audio-Visual) integration business based in India. We have
built an internal inventory and operations management platform on AWS that sends
exclusively transactional emails related to our own business operations:

1. Invoice payment reminders to our clients (T-15 to T+45 days, aligned with
   our signed purchase orders and the MSMED Act 2006 statutory 45-day window).

2. Delivery challan (DC) documents emailed to clients as PDF attachments on
   dispatch. DCs are legal documents under India's GST rules.

3. Purchase orders emailed to our verified vendors as PDF attachments.

4. Internal role-based operational digests (inventory alerts, warranty
   expiries, AMC renewals) sent to our own authenticated employees only.

5. MSMED Act 2006 statutory compliance notices to clients whose invoices
   exceed the 45-day payment window — we are a registered MSME enterprise
   (Udyam Registration Number available on request).

No marketing, promotional, bulk, or unsolicited mail. Every recipient is a
known business counterparty (client, vendor) or a system user whose email was
added via our authenticated Cognito user pool. Every email includes an
unsubscribe link and a company reply-to address.

Expected volume: ~50-500 emails/day in steady state, with bursts on the 1st
of every month. We request a 10,000/day quota to accommodate peak periods.

Bounce and complaint handling: All outbound mail uses an SES configuration
set with SNS notifications to an internal queue; bounces above 5% or
complaints above 0.1% trigger immediate alerting to our operations team.

All domain identities are DKIM-signed and SPF/DMARC-configured. Our platform
is documented internally at `inventory.yourco.in/docs`.
```

**Additional contacts** (AWS may reply here): `ops@yourco.in`

**How do you plan to handle bounces and complaints?**:

```
We use an SES configuration set (`av-inventory-prod`) with event-destination
SNS topics for Bounce and Complaint events. An internal Lambda consumes the
SNS topic and:
  - On soft bounce: exponential-backoff retry (max 3)
  - On hard bounce: marks recipient as `unreachable` in the user/client
    record; no further emails sent
  - On complaint: marks recipient as `unsubscribed`; permanent suppression

We monitor bounce rate daily via CloudWatch alarms (threshold 5%) and
complaint rate (threshold 0.1%) with immediate paging to our operations team.
```

**How do you plan to handle unsubscribe requests?**:

```
Every email includes a one-click unsubscribe link bound to a signed token
(no login required). Clicking the link updates the user's / client's
email-preference record in DynamoDB and the user is excluded from all
non-critical categories (daily digests, warranty alerts, etc.). Critical
legal notices (payment demands, MSME statutory communications, invoice
delivery) continue only to the recipient's primary billing contact as
required under the MSMED Act.
```

## After approval

1. Move SES templates from sandbox to prod (automatic on promotion).
2. Update `.env.prod`:
   ```
   SES_FROM_EMAIL=no-reply@inventory.yourco.in
   SES_REPLY_TO=ops@yourco.in
   SES_CONFIGURATION_SET=av-inventory-prod
   ```
3. Re-deploy so the Lambda env vars are picked up: `npm run deploy:prod`
