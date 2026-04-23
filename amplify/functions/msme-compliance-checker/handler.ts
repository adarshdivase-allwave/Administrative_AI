/**
 * msme-compliance-checker — daily scan @ 10 AM IST.
 *
 * Trigger: paymentStatus ≠ PAID AND (today - invoiceDate) ≥ MIN(45, paymentTermsDays)
 *
 * Under MSMED Act 2006:
 *   - Section 15: buyer must pay within 45 days of acceptance (or agreed term,
 *     whichever is EARLIER).
 *   - Section 16: compound interest at 3× RBI bank rate accrues if not paid.
 *
 * Our response on trigger:
 *   1. Honour SystemSettings.msmeEnabled and msmeRequireAdminApproval flags.
 *   2. Skip invoices already carrying status = MSME_NOTICE_SENT (already chased).
 *   3. Build the MSME_COMPLIANCE_NOTICE raw MIME email with:
 *      - certificate PDF attached from S3 (msme/certificate.pdf or configured key)
 *      - full statutory language from Sections 15 & 16
 *   4. CC company ops email + invoice's assigned salesperson.
 *   5. Write MSMEComplianceLog.
 *   6. Update invoice.status = MSME_NOTICE_SENT, invoice.msmeNoticeSentAt = now.
 */
import type { ScheduledHandler } from "aws-lambda";
import { randomUUID } from "node:crypto";
import { scanItems, getItem, updateItem, putItem } from "../_lib/ddb.js";
import { sendRawWithAttachments } from "../_lib/ses.js";
import { writeAudit } from "../_lib/audit.js";
import { formatInr } from "../../../shared/currency.js";
import { formatIST, daysBetween } from "../../../shared/fy.js";

interface InvoiceRow {
  id: string;
  invoiceNumber: string;
  invoiceDate: string;
  dueDate: string;
  totalAmountInr: number;
  amountDueInr: number;
  clientId: string;
  salespersonUserId?: string;
  paymentTermsDays?: number;
  status?: string;
  msmeNoticeSentAt?: string;
}
interface ClientRow {
  id: string;
  name: string;
  contactEmail?: string;
  billingEmail?: string;
  billingAddressLine1?: string;
  billingCity?: string;
}
interface SettingsRow {
  msmeEnabled?: boolean;
  msmeUdyamRegistrationNumber?: string;
  msmeCertificateS3Key?: string;
  msmeEnterpriseClassification?: string;
  msmeRequireAdminApproval?: boolean;
  msmeAutoTriggerDays?: number;
  companyName?: string;
  companyGstin?: string;
  companyAddressLine1?: string;
}

export const handler: ScheduledHandler = async () => {
  const settings = await readSettings();
  if (!settings?.msmeEnabled) {
    console.info("[msme] disabled in SystemSettings — skipping run");
    return;
  }
  if (!settings.msmeUdyamRegistrationNumber) {
    console.warn("[msme] msmeUdyamRegistrationNumber missing — cannot send compliant notice");
    return;
  }
  if (!settings.msmeCertificateS3Key) {
    console.warn("[msme] msmeCertificateS3Key missing — cannot attach certificate");
    return;
  }

  const triggerDays = settings.msmeAutoTriggerDays ?? 45;
  const today = new Date();

  // Pull every invoice that isn't yet paid/cancelled/disputed.
  const invoices = await scanItems<InvoiceRow>("ClientInvoice", {
    FilterExpression: "#s IN (:s1, :s2, :s3, :s4, :s5, :s6, :s7)",
    ExpressionAttributeNames: { "#s": "status" },
    ExpressionAttributeValues: {
      ":s1": "SENT",
      ":s2": "CONFIRMATION_PENDING",
      ":s3": "CONFIRMED",
      ":s4": "REMINDER_SENT",
      ":s5": "DUE_TODAY",
      ":s6": "OVERDUE",
      ":s7": "DRAFT",
    },
  });

  let triggered = 0;
  let skipped = 0;
  let pendingApproval = 0;

  for (const inv of invoices) {
    const ageDays = daysBetween(new Date(inv.invoiceDate), today);
    const threshold = Math.min(triggerDays, inv.paymentTermsDays ?? triggerDays);
    if (ageDays < threshold) {
      skipped++;
      continue;
    }
    if (inv.status === "MSME_NOTICE_SENT") {
      skipped++;
      continue;
    }

    if (settings.msmeRequireAdminApproval) {
      // Surface an approval request via StockAlert row; Admin clicks "Approve"
      // in the UI which then invokes this handler with a forceSend payload
      // (future iteration — for now we flag and skip).
      await putItem("StockAlert", {
        id: randomUUID(),
        alertType: "MSME_ADMIN_APPROVAL_REQUEST",
        severity: "WARNING",
        message: `Invoice ${inv.invoiceNumber} (${ageDays}d overdue) is awaiting Admin approval to send MSME notice.`,
        generatedAt: new Date().toISOString(),
        isActive: "TRUE",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
      pendingApproval++;
      continue;
    }

    try {
      await dispatchMsmeNotice(inv, settings, ageDays);
      triggered++;
    } catch (e) {
      console.error(
        `[msme] failed to send notice for ${inv.invoiceNumber}:`,
        (e as Error).message,
      );
    }
  }

  await writeAudit({
    actorRole: "SYSTEM",
    action: "MSME_COMPLIANCE_SCAN",
    entityType: "MSMEComplianceRun",
    entityId: today.toISOString().slice(0, 10),
    after: {
      totalScanned: invoices.length,
      triggered,
      skipped,
      pendingApproval,
      thresholdDays: triggerDays,
    },
  });

  console.info(
    `[msme] done: scanned=${invoices.length} triggered=${triggered} skipped=${skipped} pendingApproval=${pendingApproval}`,
  );
};

async function readSettings(): Promise<SettingsRow | null> {
  const rows = await scanItems<SettingsRow>("SystemSettings", { Limit: 1 });
  return rows[0] ?? null;
}

async function dispatchMsmeNotice(
  inv: InvoiceRow,
  settings: SettingsRow,
  daysOverdue: number,
): Promise<void> {
  const client = await getItem<ClientRow>("Client", { id: inv.clientId });
  if (!client) throw new Error(`Client ${inv.clientId} not found`);
  const clientEmail = client.billingEmail ?? client.contactEmail;
  if (!clientEmail) throw new Error(`Client ${client.name} has no email`);

  const cc: string[] = [];
  if (process.env.COMPANY_OPS_EMAIL) cc.push(process.env.COMPANY_OPS_EMAIL);
  if (inv.salespersonUserId) {
    const sp = await getItem<{ email?: string }>("User", { id: inv.salespersonUserId }).catch(
      () => undefined,
    );
    if (sp?.email) cc.push(sp.email);
  }

  const certificateBucket = process.env.PRIVATE_BUCKET_NAME;
  if (!certificateBucket) throw new Error("PRIVATE_BUCKET_NAME env var not set");

  const html = buildMsmeNoticeHtml({ inv, client, settings, daysOverdue });
  const subject = `MSME Act 2006 — Payment notice for Invoice ${inv.invoiceNumber}`;

  const messageId = await sendRawWithAttachments({
    to: [clientEmail],
    cc,
    subject,
    html,
    attachments: [
      {
        s3Bucket: certificateBucket,
        s3Key: settings.msmeCertificateS3Key!,
        filename: "MSME-Certificate.pdf",
        contentType: "application/pdf",
      },
    ],
  });

  const now = new Date().toISOString();

  await putItem("MSMEComplianceLog", {
    id: randomUUID(),
    invoiceId: inv.id,
    sentAt: now,
    daysOverdue,
    recipientEmails: [clientEmail, ...cc],
    templateUsed: "MSME_COMPLIANCE_NOTICE",
    sesMessageId: messageId,
    certificateAttachedS3Key: settings.msmeCertificateS3Key,
    createdAt: now,
    updatedAt: now,
  });

  await updateItem("ClientInvoice", { id: inv.id }, {
    UpdateExpression: "SET #s = :s, msmeNoticeSentAt = :t, updatedAt = :t",
    ExpressionAttributeNames: { "#s": "status" },
    ExpressionAttributeValues: { ":s": "MSME_NOTICE_SENT", ":t": now },
  });

  await writeAudit({
    actorRole: "SYSTEM",
    action: "MSME_NOTICE_SENT",
    entityType: "ClientInvoice",
    entityId: inv.id,
    after: { invoiceNumber: inv.invoiceNumber, daysOverdue, messageId },
  });
}

function buildMsmeNoticeHtml(args: {
  inv: InvoiceRow;
  client: ClientRow;
  settings: SettingsRow;
  daysOverdue: number;
}): string {
  const { inv, client, settings, daysOverdue } = args;
  const today = formatIST(new Date());
  const amount = formatInr(inv.amountDueInr, { showSymbol: false });
  const company = settings.companyName ?? "Our Company";

  return `<!doctype html>
<html>
<body style="font-family: -apple-system, Segoe UI, Arial, sans-serif; max-width: 680px; margin: 0 auto; padding: 24px; color: #222;">

  <h2 style="color: #b91c1c; margin-top: 0;">MSMED Act, 2006 — Statutory Payment Notice</h2>

  <p><strong>Date:</strong> ${today}</p>
  <p><strong>To:</strong> ${client.name}<br/>
     ${client.billingAddressLine1 ?? ""}<br/>
     ${client.billingCity ?? ""}</p>

  <p><strong>Subject:</strong> Demand for payment — Invoice <code>${inv.invoiceNumber}</code>
     dated ${formatIST(new Date(inv.invoiceDate))}, outstanding for ${daysOverdue} days.</p>

  <p>This is a formal communication pursuant to the Micro, Small and Medium Enterprises
     Development Act, 2006 (the "<strong>MSMED Act</strong>"). ${company} is a registered
     <strong>${settings.msmeEnterpriseClassification ?? "MSME"}</strong> enterprise under
     Udyam Registration Number
     <strong>${settings.msmeUdyamRegistrationNumber ?? "[missing]"}</strong>.
     A copy of our MSME certificate is attached to this email for your records.</p>

  <h3>Invoice details</h3>
  <table style="border-collapse: collapse; width: 100%; margin: 12px 0;">
    <tr><td style="padding: 6px; border: 1px solid #ddd;"><strong>Invoice number</strong></td>
        <td style="padding: 6px; border: 1px solid #ddd;"><code>${inv.invoiceNumber}</code></td></tr>
    <tr><td style="padding: 6px; border: 1px solid #ddd;"><strong>Invoice date</strong></td>
        <td style="padding: 6px; border: 1px solid #ddd;">${formatIST(new Date(inv.invoiceDate))}</td></tr>
    <tr><td style="padding: 6px; border: 1px solid #ddd;"><strong>Due date</strong></td>
        <td style="padding: 6px; border: 1px solid #ddd;">${formatIST(new Date(inv.dueDate))}</td></tr>
    <tr><td style="padding: 6px; border: 1px solid #ddd;"><strong>Amount outstanding</strong></td>
        <td style="padding: 6px; border: 1px solid #ddd;">₹ ${amount}</td></tr>
    <tr><td style="padding: 6px; border: 1px solid #ddd;"><strong>Days outstanding</strong></td>
        <td style="padding: 6px; border: 1px solid #ddd;">${daysOverdue} days</td></tr>
  </table>

  <h3>Statutory position</h3>
  <p><strong>Section 15</strong> of the MSMED Act requires a buyer to make payment for goods
     or services supplied by an MSME on or before the agreed date, or where there is no
     agreement, <strong>before the appointed day</strong> (45 days from acceptance or deemed
     acceptance), <em>whichever is earlier</em>. As of ${today}, the above invoice remains
     unpaid for <strong>${daysOverdue} days</strong>.</p>

  <p><strong>Section 16</strong> provides that, notwithstanding anything contained in any
     agreement or law, a buyer who fails to make payment within the period specified in
     Section 15 shall be liable to pay <strong>compound interest with monthly rests</strong>
     at three times the bank rate notified by the Reserve Bank of India, from the appointed
     day onward.</p>

  <p>We therefore call upon you to remit the sum of <strong>₹ ${amount}</strong> immediately,
     failing which we will be constrained to refer the dispute to the
     Micro and Small Enterprises Facilitation Council for resolution under Section 18 of the
     MSMED Act, without further notice.</p>

  <p>If you believe this notice has been issued in error, please reply to this email within
     7 days with supporting documentation.</p>

  <p>Regards,<br/>
     ${company}<br/>
     GSTIN: ${settings.companyGstin ?? ""}<br/>
     Udyam Registration: ${settings.msmeUdyamRegistrationNumber}</p>

  <hr style="margin-top: 32px; border: none; border-top: 1px solid #eee;"/>
  <p style="font-size: 11px; color: #777;">
    This is a system-generated notice served under the MSMED Act, 2006. The attached
    <code>MSME-Certificate.pdf</code> evidences our registration as an MSME enterprise.
  </p>
</body>
</html>`;
}
