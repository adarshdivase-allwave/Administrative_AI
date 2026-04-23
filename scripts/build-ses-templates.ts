#!/usr/bin/env tsx
/**
 * Builds all 22 SES HTML email templates from a shared layout + per-template
 * content. Emits each to `ses-templates/{file}.html`.
 *
 * Design rules:
 *   - Table-based layout — the only format Outlook renders reliably
 *   - All styles inline (Gmail strips `<head><style>`)
 *   - 600px max width with mobile fluid fallback
 *   - Dark-mode-tolerant color palette (grays + reds that look OK on both)
 *   - SES Handlebars {{var}} placeholders for dynamic content
 *   - Shared header with company logo + shared footer with unsubscribe link
 *
 * Rerun this script whenever layout changes:
 *   npm run build:ses-templates
 */
import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const OUT_DIR = join(dirname(__filename), "..", "ses-templates");
if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });

// ============================================================================
// Layout primitives (all inline-styled, table-based)
// ============================================================================

interface LayoutOptions {
  preheader: string;
  body: string;
  ctaText?: string;
  ctaUrl?: string;
  accentColor?: string; // e.g. "#b91c1c" for MSME/overdue; default slate
}

function layout(opts: LayoutOptions): string {
  const accent = opts.accentColor ?? "#334155";
  const cta = opts.ctaText && opts.ctaUrl ? button(opts.ctaText, opts.ctaUrl, accent) : "";
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<meta name="color-scheme" content="light dark" />
<title>{{companyName}}</title>
</head>
<body style="margin:0; padding:0; background-color:#f4f4f5; font-family: -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color:#111827;">

<div style="display:none; max-height:0; overflow:hidden; font-size:1px; line-height:1px; color:#f4f4f5;">${opts.preheader}</div>

<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f4f4f5;">
  <tr>
    <td align="center" style="padding:24px 12px;">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px; background:#ffffff; border-radius:8px; box-shadow:0 1px 3px rgba(0,0,0,0.08);">

        <!-- Header -->
        <tr>
          <td style="padding:20px 32px; border-bottom:1px solid #e5e7eb;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td align="left">
                  <a href="{{logoUrl}}" style="text-decoration:none; color:${accent};">
                    <span style="font-size:18px; font-weight:700; color:${accent};">{{companyName}}</span>
                  </a>
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <!-- Body -->
        <tr>
          <td style="padding:28px 32px; font-size:15px; line-height:1.55; color:#111827;">
            ${opts.body}
            ${cta}
          </td>
        </tr>

        <!-- Footer -->
        <tr>
          <td style="padding:20px 32px; border-top:1px solid #e5e7eb; font-size:12px; line-height:1.5; color:#6b7280;">
            <div>&copy; {{companyName}} &middot; This is an automated message from our inventory platform.</div>
            <div style="margin-top:6px;">
              Questions? Reply to this email or write to <a href="mailto:{{replyEmail}}" style="color:#374151;">{{replyEmail}}</a>.
            </div>
            <div style="margin-top:10px;">
              <a href="{{unsubscribeUrl}}" style="color:#9ca3af; text-decoration:underline;">Unsubscribe from non-critical notifications</a>
            </div>
          </td>
        </tr>

      </table>
    </td>
  </tr>
</table>

</body>
</html>`;
}

function button(text: string, url: string, color = "#334155"): string {
  return `
<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:24px 0;">
  <tr>
    <td align="center" bgcolor="${color}" style="border-radius:6px;">
      <a href="${url}" style="display:inline-block; padding:12px 28px; font-size:15px; font-weight:600; color:#ffffff; text-decoration:none; border-radius:6px;">${text}</a>
    </td>
  </tr>
</table>`;
}

function kvTable(rows: Array<[string, string]>): string {
  return `
<table role="presentation" width="100%" cellpadding="6" cellspacing="0" border="0" style="border-collapse:collapse; margin:12px 0;">
${rows
  .map(
    ([k, v]) => `
  <tr>
    <td style="border:1px solid #e5e7eb; background:#f9fafb; font-weight:600; width:40%;">${k}</td>
    <td style="border:1px solid #e5e7eb;">${v}</td>
  </tr>`,
  )
  .join("")}
</table>`;
}

function note(text: string, tone: "info" | "warn" | "danger" = "info"): string {
  const bg = { info: "#eff6ff", warn: "#fffbeb", danger: "#fef2f2" }[tone];
  const border = { info: "#60a5fa", warn: "#f59e0b", danger: "#ef4444" }[tone];
  return `<div style="margin:16px 0; padding:12px 16px; background:${bg}; border-left:4px solid ${border}; border-radius:4px; font-size:14px;">${text}</div>`;
}

// ============================================================================
// Per-template content
// ============================================================================

interface Template {
  file: string;
  build: () => string;
}

const templates: Template[] = [
  // -------- Payment reminders --------
  {
    file: "payment-reminder-15d.html",
    build: () =>
      layout({
        preheader: "Your invoice is due in 15 days — gentle reminder",
        body: `
<h2 style="margin:0 0 12px 0; font-size:20px; color:#111827;">Invoice due in 15 days</h2>
<p>Hi {{clientName}},</p>
<p>This is a gentle reminder that invoice <strong>{{invoiceNumber}}</strong> is scheduled for payment on <strong>{{dueDate}}</strong>.</p>
${kvTable([
  ["Invoice number", "{{invoiceNumber}}"],
  ["Amount", "₹ {{totalAmount}}"],
  ["Due date", "{{dueDate}}"],
])}
<p>If payment has already been initiated, please ignore this note — our records will update automatically on receipt.</p>`,
      }),
  },
  {
    file: "payment-reminder-7d.html",
    build: () =>
      layout({
        preheader: "Invoice due in 7 days",
        body: `
<h2 style="margin:0 0 12px 0; font-size:20px;">Invoice due in 7 days</h2>
<p>Hi {{clientName}},</p>
<p>Invoice <strong>{{invoiceNumber}}</strong> for ₹ {{totalAmount}} is due for payment on <strong>{{dueDate}}</strong> — one week from today.</p>
${kvTable([
  ["Invoice number", "{{invoiceNumber}}"],
  ["Amount", "₹ {{totalAmount}}"],
  ["Due date", "{{dueDate}}"],
])}
<p>Please arrange payment at your convenience.</p>`,
      }),
  },
  {
    file: "payment-reminder-due.html",
    build: () =>
      layout({
        accentColor: "#b45309",
        preheader: "Invoice is due today",
        body: `
<h2 style="margin:0 0 12px 0; font-size:20px; color:#b45309;">Invoice due today</h2>
<p>Hi {{clientName}},</p>
<p>Invoice <strong>{{invoiceNumber}}</strong> for <strong>₹ {{totalAmount}}</strong> is due for payment <strong>today, {{dueDate}}</strong>.</p>
${note("Please process payment at your earliest convenience to avoid late-payment interest under the MSMED Act.", "warn")}
${kvTable([
  ["Invoice number", "{{invoiceNumber}}"],
  ["Amount", "₹ {{totalAmount}}"],
  ["Due date", "{{dueDate}}"],
])}`,
      }),
  },
  {
    file: "payment-reminder-overdue.html",
    build: () =>
      layout({
        accentColor: "#b91c1c",
        preheader: "Payment is {{daysOverdue}} days overdue",
        body: `
<h2 style="margin:0 0 12px 0; font-size:20px; color:#b91c1c;">Invoice {{daysOverdue}} days overdue</h2>
<p>Hi {{clientName}},</p>
<p>Our records show invoice <strong>{{invoiceNumber}}</strong> for ₹ {{totalAmount}} remains unpaid, <strong>{{daysOverdue}} days</strong> past the due date of {{dueDate}}.</p>
${note("Please settle this invoice at the earliest. Unpaid MSME invoices past 45 days attract compound interest under Section 16 of the MSMED Act 2006.", "danger")}
${kvTable([
  ["Invoice number", "{{invoiceNumber}}"],
  ["Amount outstanding", "₹ {{amountDue}}"],
  ["Due date", "{{dueDate}}"],
  ["Days overdue", "{{daysOverdue}}"],
])}
<p>If you have already processed this payment, please reply with the transaction reference so we can reconcile our records.</p>`,
      }),
  },
  {
    file: "payment-salesperson-alert.html",
    build: () =>
      layout({
        accentColor: "#b45309",
        preheader: "Action needed: overdue invoice {{invoiceNumber}}",
        body: `
<h2 style="margin:0 0 12px 0; font-size:20px;">Follow up required</h2>
<p>Hi {{salespersonName}},</p>
<p>Invoice <strong>{{invoiceNumber}}</strong> for <strong>{{clientName}}</strong> ({{amountDue}} INR) is overdue and needs a follow-up call.</p>
${kvTable([
  ["Client", "{{clientName}}"],
  ["Invoice", "{{invoiceNumber}}"],
  ["Amount", "₹ {{amountDue}}"],
  ["Due date", "{{dueDate}}"],
  ["Days overdue", "{{daysOverdue}}"],
])}
<p>Please update the invoice notes in the Inventory platform after speaking with the client.</p>`,
      }),
  },
  // -------- MSME --------
  {
    file: "msme-compliance-notice.html",
    build: () =>
      layout({
        accentColor: "#b91c1c",
        preheader: "MSMED Act 2006 — Statutory payment notice",
        body: `
<h2 style="margin:0 0 12px 0; font-size:20px; color:#b91c1c;">MSMED Act, 2006 — Statutory Payment Notice</h2>
<p>Dear {{clientName}},</p>
<p>This is a formal communication pursuant to the Micro, Small and Medium Enterprises Development Act, 2006 (the "<strong>MSMED Act</strong>"). {{companyName}} is a registered MSME enterprise under Udyam Registration Number <strong>{{udyamNumber}}</strong>. A copy of our MSME certificate is attached to this email.</p>

<h3 style="font-size:15px; margin-top:18px;">Invoice details</h3>
${kvTable([
  ["Invoice number", "{{invoiceNumber}}"],
  ["Invoice date", "{{invoiceDate}}"],
  ["Due date", "{{dueDate}}"],
  ["Amount outstanding", "₹ {{amountDue}}"],
  ["Days outstanding", "{{daysOverdue}} days"],
])}

<h3 style="font-size:15px; margin-top:18px;">Statutory position</h3>
<p><strong>Section 15</strong> of the MSMED Act requires a buyer to make payment for goods or services supplied by an MSME on or before the agreed date, or where there is no agreement, before the appointed day (45 days from acceptance or deemed acceptance), whichever is earlier. As of today, the above invoice remains unpaid for <strong>{{daysOverdue}} days</strong>.</p>
<p><strong>Section 16</strong> provides that, notwithstanding anything contained in any agreement or law, a buyer who fails to make payment within the period specified in Section 15 shall be liable to pay <strong>compound interest with monthly rests at three times the bank rate notified by the Reserve Bank of India</strong>, from the appointed day onward.</p>

${note(
  "We call upon you to remit the outstanding amount of ₹ {{amountDue}} immediately. Failing this, we will be constrained to refer the dispute to the Micro and Small Enterprises Facilitation Council for resolution under Section 18 of the MSMED Act, without further notice.",
  "danger",
)}

<p>If you believe this notice has been issued in error, please reply within 7 days with supporting documentation.</p>

<p style="margin-top:20px;">Regards,<br/>
{{companyName}}<br/>
GSTIN: {{companyGstin}}<br/>
Udyam Registration: {{udyamNumber}}</p>`,
      }),
  },

  // -------- Invoice confirmation --------
  {
    file: "invoice-confirmation-request.html",
    build: () =>
      layout({
        preheader: "Please confirm receipt of Invoice {{invoiceNumber}}",
        body: `
<h2 style="margin:0 0 12px 0; font-size:20px;">Please confirm invoice receipt</h2>
<p>Hi {{clientName}},</p>
<p>We sent you invoice <strong>{{invoiceNumber}}</strong> dated {{invoiceDate}} for <strong>₹ {{amount}}</strong>. Please confirm you've received it so we can keep our records accurate.</p>`,
        ctaText: "Confirm receipt",
        ctaUrl: "{{confirmUrl}}",
      }),
  },
  {
    file: "invoice-auto-acceptance.html",
    build: () =>
      layout({
        accentColor: "#4338ca",
        preheader: "Invoice {{invoiceNumber}} deemed accepted",
        body: `
<h2 style="margin:0 0 12px 0; font-size:20px;">Invoice deemed accepted</h2>
<p>Hi {{clientName}},</p>
<p>As no objection has been raised within the stipulated timeframe, invoice <strong>{{invoiceNumber}}</strong> dated {{invoiceDate}} for <strong>₹ {{amount}}</strong> is hereby considered received, accepted, and under process for payment. Payment of ₹ {{amount}} is due on <strong>{{dueDate}}</strong>.</p>
${kvTable([
  ["Invoice", "{{invoiceNumber}}"],
  ["Amount", "₹ {{amount}}"],
  ["Due date", "{{dueDate}}"],
])}`,
      }),
  },
  // -------- Bills --------
  {
    file: "bill-reminder.html",
    build: () =>
      layout({
        preheader: "Bill {{billDescription}} is due on {{dueDate}}",
        body: `
<h2 style="margin:0 0 12px 0; font-size:20px;">Upcoming bill</h2>
<p>This is a reminder that the following bill is due soon:</p>
${kvTable([
  ["Description", "{{billDescription}}"],
  ["Due date", "{{dueDate}}"],
  ["Amount (estimate)", "₹ {{amount}}"],
])}
<p>Please arrange payment and upload the receipt to the inventory platform.</p>`,
      }),
  },
  // -------- Inventory alerts --------
  {
    file: "alert-out-of-stock.html",
    build: () =>
      layout({
        accentColor: "#b91c1c",
        preheader: "Out of stock: {{productName}}",
        body: `
<h2 style="margin:0 0 12px 0; font-size:20px; color:#b91c1c;">Out of stock</h2>
<p>Product <strong>{{productName}}</strong> is now out of stock in General Stock. Consider raising a purchase order.</p>`,
      }),
  },
  {
    file: "alert-low-stock.html",
    build: () =>
      layout({
        accentColor: "#b45309",
        preheader: "Low stock: {{productName}}",
        body: `
<h2 style="margin:0 0 12px 0; font-size:20px; color:#b45309;">Low stock</h2>
<p>Stock of <strong>{{productName}}</strong> has dropped below the configured reorder threshold. Consider raising a purchase order.</p>`,
      }),
  },
  {
    file: "alert-import-needed.html",
    build: () =>
      layout({
        preheader: "Import needed: {{productName}}",
        body: `
<h2 style="margin:0 0 12px 0; font-size:20px;">Imported item needs reorder</h2>
<p>The imported product <strong>{{productName}}</strong> is running low. Because this item has a long lead time, please plan the purchase order early.</p>`,
      }),
  },
  {
    file: "alert-overdue-return.html",
    build: () =>
      layout({
        accentColor: "#b45309",
        preheader: "Overdue return: {{unitSerial}}",
        body: `
<h2 style="margin:0 0 12px 0; font-size:20px;">Overdue return</h2>
<p>Unit <code>{{unitSerial}}</code> on project <strong>{{projectName}}</strong> is past its expected return date. Please contact the site team.</p>`,
      }),
  },
  {
    file: "alert-warranty-expiring.html",
    build: () =>
      layout({
        preheader: "Warranty expiring: {{unitSerial}}",
        body: `
<h2 style="margin:0 0 12px 0; font-size:20px;">Warranty expiring soon</h2>
<p>{{unitCount}} unit(s) have warranties expiring in the next 90 days.</p>
{{unitsHtml}}`,
      }),
  },
  {
    file: "alert-amc-expiring.html",
    build: () =>
      layout({
        preheader: "AMC expiring: {{contractNumber}}",
        body: `
<h2 style="margin:0 0 12px 0; font-size:20px;">AMC contract expiring soon</h2>
<p>{{count}} AMC contract(s) are expiring in the next 45 days. Please review renewal decisions in the Inventory platform.</p>`,
      }),
  },

  // -------- Procurement --------
  {
    file: "alert-po-approval-request.html",
    build: () =>
      layout({
        accentColor: "#b45309",
        preheader: "Approve PO {{poNumber}}",
        body: `
<h2 style="margin:0 0 12px 0; font-size:20px;">PO awaiting approval</h2>
<p>Purchase order <strong>{{poNumber}}</strong> for ₹ {{poValue}} is above the auto-approval threshold and needs Admin sign-off.</p>`,
        ctaText: "Review and approve",
        ctaUrl: "{{approvalUrl}}",
      }),
  },
  {
    file: "alert-po-approved.html",
    build: () =>
      layout({
        accentColor: "#15803d",
        preheader: "PO {{poNumber}} approved",
        body: `
<h2 style="margin:0 0 12px 0; font-size:20px; color:#15803d;">PO approved</h2>
<p>Your purchase order <strong>{{poNumber}}</strong> has been approved and sent to the vendor.</p>`,
      }),
  },
  {
    file: "alert-po-rejected.html",
    build: () =>
      layout({
        accentColor: "#b91c1c",
        preheader: "PO {{poNumber}} rejected",
        body: `
<h2 style="margin:0 0 12px 0; font-size:20px; color:#b91c1c;">PO rejected</h2>
<p>Purchase order <strong>{{poNumber}}</strong> has been rejected with the following reason:</p>
${note("{{rejectionReason}}", "danger")}
<p>Please review and resubmit with the requested changes.</p>`,
      }),
  },

  // -------- Staff / digest --------
  {
    file: "staff-reminder.html",
    build: () =>
      layout({
        preheader: "Reminder: {{reminderTitle}}",
        body: `
<h2 style="margin:0 0 12px 0; font-size:20px;">Reminder</h2>
<p>Hi {{recipientName}},</p>
<p><strong>{{reminderTitle}}</strong></p>
<p>{{reminderBody}}</p>
<p style="color:#6b7280; font-size:13px; margin-top:18px;">Scheduled for {{remindAt}}.</p>`,
      }),
  },
  {
    file: "daily-digest.html",
    build: () =>
      layout({
        preheader: "Your {{role}} digest for {{digestDate}}",
        body: `
<h2 style="margin:0 0 12px 0; font-size:20px;">{{role}} digest &middot; {{digestDate}}</h2>
<p>Here's your personalized rollup for today.</p>
{{roleSections}}`,
      }),
  },

  // -------- Documents --------
  {
    file: "dc-to-client.html",
    build: () =>
      layout({
        preheader: "Delivery Challan {{dcNumber}}",
        body: `
<h2 style="margin:0 0 12px 0; font-size:20px;">Delivery Challan</h2>
<p>Dear {{clientName}},</p>
<p>Please find attached Delivery Challan <strong>{{dcNumber}}</strong> for the consignment dispatched on {{dcDate}}. Kindly acknowledge receipt by signing the duplicate copy.</p>
${kvTable([
  ["DC number", "{{dcNumber}}"],
  ["DC date", "{{dcDate}}"],
  ["Transporter", "{{transporterName}}"],
  ["Vehicle", "{{vehicleNumber}}"],
  ["e-Way Bill", "{{eWayBillNumber}}"],
])}`,
      }),
  },
  {
    file: "po-to-vendor.html",
    build: () =>
      layout({
        preheader: "Purchase Order {{poNumber}}",
        body: `
<h2 style="margin:0 0 12px 0; font-size:20px;">Purchase Order</h2>
<p>Dear {{vendorName}},</p>
<p>Please find attached Purchase Order <strong>{{poNumber}}</strong> dated {{poDate}}. Kindly acknowledge the order and share the expected delivery schedule.</p>
${kvTable([
  ["PO number", "{{poNumber}}"],
  ["PO date", "{{poDate}}"],
  ["Total value", "₹ {{poValue}}"],
  ["Expected delivery", "{{expectedDeliveryDate}}"],
])}`,
      }),
  },
  {
    file: "client-portal-link.html",
    build: () =>
      layout({
        preheader: "Your project delivery portal is ready",
        body: `
<h2 style="margin:0 0 12px 0; font-size:20px;">Project delivery portal</h2>
<p>Hi {{clientName}},</p>
<p>You can track the status of every item we've allocated to <strong>{{projectName}}</strong> via the secure portal link below. The link is valid until {{portalExpiryDate}}.</p>`,
        ctaText: "Open delivery portal",
        ctaUrl: "{{portalUrl}}",
      }),
  },
];

// Note: spec §24 header says "22 templates" but the pipe-separated list
// that follows actually contains 23 distinct names. Treating the list as
// authoritative — amplify/custom/ses-templates.ts manifest has 23 too.
const EXPECTED = 23;
if (templates.length !== EXPECTED) {
  throw new Error(`Expected ${EXPECTED} templates, got ${templates.length}`);
}

for (const t of templates) {
  const html = t.build();
  writeFileSync(join(OUT_DIR, t.file), html);
  console.log(`✓ ${t.file}  (${html.length} bytes)`);
}
console.log(`\n${templates.length} SES templates written to ${OUT_DIR}`);
