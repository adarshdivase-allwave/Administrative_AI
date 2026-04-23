/**
 * SES v2 helper — two paths:
 *   - Templated simple send (SES template + variables, no attachments)
 *   - Raw MIME send (for the MSME certificate and DC/PO PDF attachment cases)
 *
 * Template names are qualified with APP_ENV suffix (e.g. MSME_COMPLIANCE_NOTICE_PROD)
 * so dev/staging/prod can iterate templates independently without cross-contamination.
 */
import { SendEmailCommand } from "@aws-sdk/client-sesv2";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { sesClient, s3Client } from "./aws-clients.js";

function resolveFromAddress(): string {
  const from = process.env.SES_FROM_EMAIL;
  if (!from) {
    throw new Error(
      "SES_FROM_EMAIL env var not set — verified sending identity is mandatory.",
    );
  }
  return from;
}

function resolveReplyTo(): string | undefined {
  return process.env.SES_REPLY_TO ?? undefined;
}

function templateName(baseName: string): string {
  const suffix = (process.env.APP_ENV ?? "dev").toUpperCase();
  return `${baseName}_${suffix}`;
}

/** Shape of data passed into SES template Handlebars. */
export type TemplateData = Record<string, string | number | boolean | null | undefined>;

export interface SendTemplatedOptions {
  to: string[];
  cc?: string[];
  bcc?: string[];
  templateName: string;
  templateData: TemplateData;
  configurationSet?: string;
}

/** Basic templated send — no attachments. */
export async function sendTemplatedEmail(opts: SendTemplatedOptions): Promise<string> {
  const res = await sesClient().send(
    new SendEmailCommand({
      FromEmailAddress: resolveFromAddress(),
      ReplyToAddresses: resolveReplyTo() ? [resolveReplyTo()!] : undefined,
      Destination: {
        ToAddresses: opts.to,
        CcAddresses: opts.cc,
        BccAddresses: opts.bcc,
      },
      Content: {
        Template: {
          TemplateName: templateName(opts.templateName),
          TemplateData: JSON.stringify(scrubData(opts.templateData)),
        },
      },
      ConfigurationSetName: opts.configurationSet ?? process.env.SES_CONFIGURATION_SET,
    }),
  );
  if (!res.MessageId) throw new Error("SES returned no MessageId");
  return res.MessageId;
}

export interface SendRawOptions {
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  html: string;
  attachments: Array<{
    s3Bucket: string;
    s3Key: string;
    filename: string;
    contentType: string;
  }>;
}

/**
 * Raw MIME send — used for templates that need file attachments
 * (MSME certificate, DC PDF, PO PDF, client-invoice PDF).
 *
 * We pull each attachment from S3 at send time so the attached bytes are
 * always the latest version of the certificate/PDF.
 */
export async function sendRawWithAttachments(opts: SendRawOptions): Promise<string> {
  const from = resolveFromAddress();
  const boundary = `----=_Part_${Date.now()}_${Math.random().toString(36).slice(2)}`;

  // Build MIME body.
  const headers = [
    `From: ${from}`,
    `To: ${opts.to.join(", ")}`,
    opts.cc?.length ? `Cc: ${opts.cc.join(", ")}` : "",
    opts.bcc?.length ? `Bcc: ${opts.bcc.join(", ")}` : "",
    resolveReplyTo() ? `Reply-To: ${resolveReplyTo()}` : "",
    `Subject: ${opts.subject}`,
    `MIME-Version: 1.0`,
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
  ]
    .filter(Boolean)
    .join("\r\n");

  const parts: string[] = [];
  parts.push(
    `--${boundary}\r\n` +
      `Content-Type: text/html; charset="UTF-8"\r\n` +
      `Content-Transfer-Encoding: base64\r\n\r\n` +
      Buffer.from(opts.html).toString("base64"),
  );

  for (const att of opts.attachments) {
    const body = await fetchS3ObjectAsBase64(att.s3Bucket, att.s3Key);
    parts.push(
      `--${boundary}\r\n` +
        `Content-Type: ${att.contentType}; name="${att.filename}"\r\n` +
        `Content-Transfer-Encoding: base64\r\n` +
        `Content-Disposition: attachment; filename="${att.filename}"\r\n\r\n` +
        body,
    );
  }

  const mime = `${headers}\r\n\r\n${parts.join("\r\n")}\r\n--${boundary}--`;

  const res = await sesClient().send(
    new SendEmailCommand({
      FromEmailAddress: from,
      ReplyToAddresses: resolveReplyTo() ? [resolveReplyTo()!] : undefined,
      Destination: {
        ToAddresses: opts.to,
        CcAddresses: opts.cc,
        BccAddresses: opts.bcc,
      },
      Content: { Raw: { Data: new TextEncoder().encode(mime) } },
      ConfigurationSetName: process.env.SES_CONFIGURATION_SET,
    }),
  );
  if (!res.MessageId) throw new Error("SES returned no MessageId");
  return res.MessageId;
}

async function fetchS3ObjectAsBase64(bucket: string, key: string): Promise<string> {
  const res = await s3Client().send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  const body = res.Body as { transformToByteArray?: () => Promise<Uint8Array> } | undefined;
  if (!body?.transformToByteArray) {
    throw new Error(`S3 GetObject body is not streamable for s3://${bucket}/${key}`);
  }
  const bytes = await body.transformToByteArray();
  // Base64 encode in 76-char-wrapped form for MIME compliance.
  const b64 = Buffer.from(bytes).toString("base64");
  return b64.replace(/(.{76})/g, "$1\r\n");
}

/** SES JSON rejects undefined values; scrub them before serializing. */
function scrubData(d: TemplateData): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  for (const [k, v] of Object.entries(d)) {
    if (v === undefined || v === null) continue;
    out[k] = v;
  }
  return out;
}

/** Helper used by every Lambda that emails from the company domain. */
export function companyLogoUrl(): string | undefined {
  return process.env.COMPANY_LOGO_PUBLIC_URL ?? undefined;
}
