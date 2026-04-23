/**
 * SES email templates — registers the 22 templates in `ses-templates/` as
 * CfnTemplate resources. Template HTML is loaded at synth time from disk.
 *
 * If a template HTML file is missing, synth falls back to a minimal placeholder
 * body so the stack still deploys — the Lambda logs a warning when it tries
 * to send, flagging the missing template file.
 */
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { Stack } from "aws-cdk-lib";
import { CfnTemplate } from "aws-cdk-lib/aws-ses";
import type { MinimalBackend } from "./_backend-types.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const TEMPLATES_DIR = join(__dirname, "..", "..", "ses-templates");

interface TemplateManifestEntry {
  templateName: string;
  subject: string;
  fileName: string;
}

/** 22 templates per spec §24. Subject lines use SES {{var}} syntax. */
const MANIFEST: TemplateManifestEntry[] = [
  { templateName: "PAYMENT_REMINDER_15D", subject: "Payment due in 15 days — Invoice {{invoiceNumber}}", fileName: "payment-reminder-15d.html" },
  { templateName: "PAYMENT_REMINDER_7D", subject: "Payment due in 7 days — Invoice {{invoiceNumber}}", fileName: "payment-reminder-7d.html" },
  { templateName: "PAYMENT_REMINDER_DUE", subject: "Payment due today — Invoice {{invoiceNumber}}", fileName: "payment-reminder-due.html" },
  { templateName: "PAYMENT_REMINDER_OVERDUE", subject: "Invoice {{invoiceNumber}} is {{daysOverdue}} days overdue", fileName: "payment-reminder-overdue.html" },
  { templateName: "PAYMENT_SALESPERSON_ALERT", subject: "Follow up: Invoice {{invoiceNumber}} due for {{clientName}}", fileName: "payment-salesperson-alert.html" },
  { templateName: "MSME_COMPLIANCE_NOTICE", subject: "MSME Act 2006 — Payment notice for Invoice {{invoiceNumber}}", fileName: "msme-compliance-notice.html" },
  { templateName: "INVOICE_CONFIRMATION_REQUEST", subject: "Please confirm receipt of Invoice {{invoiceNumber}}", fileName: "invoice-confirmation-request.html" },
  { templateName: "INVOICE_AUTO_ACCEPTANCE", subject: "Invoice {{invoiceNumber}} deemed accepted", fileName: "invoice-auto-acceptance.html" },
  { templateName: "BILL_REMINDER", subject: "Upcoming bill: {{billDescription}} due {{dueDate}}", fileName: "bill-reminder.html" },
  { templateName: "ALERT_OUT_OF_STOCK", subject: "Out of stock — {{productName}}", fileName: "alert-out-of-stock.html" },
  { templateName: "ALERT_LOW_STOCK", subject: "Low stock — {{productName}}", fileName: "alert-low-stock.html" },
  { templateName: "ALERT_IMPORT_NEEDED", subject: "Import needed — {{productName}}", fileName: "alert-import-needed.html" },
  { templateName: "ALERT_OVERDUE_RETURN", subject: "Overdue return — {{unitSerial}} on project {{projectName}}", fileName: "alert-overdue-return.html" },
  { templateName: "ALERT_WARRANTY_EXPIRING", subject: "Warranty expiring — {{unitSerial}}", fileName: "alert-warranty-expiring.html" },
  { templateName: "ALERT_AMC_EXPIRING", subject: "AMC expiring — contract {{contractNumber}}", fileName: "alert-amc-expiring.html" },
  { templateName: "ALERT_PO_APPROVAL_REQUEST", subject: "PO approval required — {{poNumber}} (INR {{poValue}})", fileName: "alert-po-approval-request.html" },
  { templateName: "ALERT_PO_APPROVED", subject: "PO {{poNumber}} approved", fileName: "alert-po-approved.html" },
  { templateName: "ALERT_PO_REJECTED", subject: "PO {{poNumber}} rejected", fileName: "alert-po-rejected.html" },
  { templateName: "STAFF_REMINDER", subject: "Reminder: {{reminderTitle}}", fileName: "staff-reminder.html" },
  { templateName: "DAILY_DIGEST", subject: "AV Inventory — {{role}} digest for {{digestDate}}", fileName: "daily-digest.html" },
  { templateName: "DC_TO_CLIENT", subject: "Delivery Challan {{dcNumber}} from {{companyName}}", fileName: "dc-to-client.html" },
  { templateName: "PO_TO_VENDOR", subject: "Purchase Order {{poNumber}}", fileName: "po-to-vendor.html" },
  { templateName: "CLIENT_PORTAL_LINK", subject: "Project delivery portal — {{projectName}}", fileName: "client-portal-link.html" },
];

export function createSesTemplates(backend: MinimalBackend): void {
  const stack = Stack.of(backend.data.stack);
  const envSuffix = (process.env.APP_ENV ?? "dev").toUpperCase();

  for (const entry of MANIFEST) {
    const qualifiedName = `${entry.templateName}_${envSuffix}`;
    const htmlPath = join(TEMPLATES_DIR, entry.fileName);
    const html = existsSync(htmlPath)
      ? readFileSync(htmlPath, "utf-8")
      : defaultPlaceholderHtml(entry.templateName);

    new CfnTemplate(stack, `SesTemplate_${entry.templateName}`, {
      template: {
        templateName: qualifiedName,
        subjectPart: entry.subject,
        htmlPart: html,
        textPart: htmlToText(html),
      },
    });
  }
}

function defaultPlaceholderHtml(name: string): string {
  return `<!doctype html>
<html><body style="font-family: sans-serif;">
<p>This is a placeholder for the <code>${name}</code> email template.</p>
<p>Replace this file under <code>ses-templates/</code> with the production HTML.</p>
</body></html>`;
}

function htmlToText(html: string): string {
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export { MANIFEST as SES_TEMPLATE_MANIFEST };
