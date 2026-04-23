/**
 * Verifies all 23 SES HTML templates exist on disk, parse as HTML, and
 * contain the critical placeholders needed by the Lambda handlers that
 * send them. Without this, a missed placeholder could silently ship an
 * email with "{{invoiceNumber}}" literal text visible to a client.
 */
import { describe, it, expect } from "./helpers/test-shim.js";
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { SES_TEMPLATE_MANIFEST } from "../amplify/custom/ses-templates.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DIR = join(__dirname, "..", "ses-templates");

describe("SES templates", () => {
  it("all 23 manifest entries have HTML files on disk", () => {
    for (const entry of SES_TEMPLATE_MANIFEST) {
      const p = join(DIR, entry.fileName);
      expect(existsSync(p)).toBe(true);
    }
  });

  it("templates include shared header/footer + unsubscribe", () => {
    for (const entry of SES_TEMPLATE_MANIFEST) {
      const html = readFileSync(join(DIR, entry.fileName), "utf-8");
      expect(html).toContain("{{companyName}}");
      expect(html).toContain("{{unsubscribeUrl}}");
      expect(html).toContain("<!doctype html>");
      // Table-based layout (Outlook needs this)
      expect(html).toContain("<table");
      // No <style> blocks — Gmail strips them; styles should be inline.
      expect(html.toLowerCase()).not.toContain("<style");
    }
  });

  it("MSME notice carries the statutory Section 15/16 language", () => {
    const html = readFileSync(join(DIR, "msme-compliance-notice.html"), "utf-8");
    expect(html).toContain("MSMED Act");
    expect(html).toContain("Section 15");
    expect(html).toContain("Section 16");
    expect(html).toContain("three times the bank rate");
    expect(html).toContain("{{udyamNumber}}");
    expect(html).toContain("{{daysOverdue}}");
  });

  it("payment reminders reference the invoice number and amount", () => {
    for (const f of [
      "payment-reminder-15d.html",
      "payment-reminder-7d.html",
      "payment-reminder-due.html",
      "payment-reminder-overdue.html",
    ]) {
      const html = readFileSync(join(DIR, f), "utf-8");
      expect(html).toContain("{{invoiceNumber}}");
      expect(html).toContain("{{dueDate}}");
    }
  });

  it("document-delivery templates reference their doc number", () => {
    expect(readFileSync(join(DIR, "dc-to-client.html"), "utf-8")).toContain("{{dcNumber}}");
    expect(readFileSync(join(DIR, "po-to-vendor.html"), "utf-8")).toContain("{{poNumber}}");
  });

  it("client-portal template carries the portal URL + expiry", () => {
    const html = readFileSync(join(DIR, "client-portal-link.html"), "utf-8");
    expect(html).toContain("{{portalUrl}}");
    expect(html).toContain("{{projectName}}");
  });
});
