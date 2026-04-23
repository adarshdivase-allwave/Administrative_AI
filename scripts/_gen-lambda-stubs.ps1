#!/usr/bin/env pwsh
# Generates Amplify Gen 2 Lambda resource.ts + handler.ts stubs.
# Used once during scaffold; safe to delete after.

$functions = @(
  @{ dir="invoice-scheduler"; export="invoiceScheduler"; profile="default"; desc="On ClientInvoice save: create EventBridge schedules for T-15/T-7/T-0/T+1/T+7/T+14/T+30/T+45 reminders. On delete: tear them down." }
  @{ dir="payment-reminder-sender"; export="paymentReminderSender"; profile="default"; desc="Triggered by invoice-scheduler schedules. Sends SES email + writes in-app notification + appends PaymentReminderLog." }
  @{ dir="msme-compliance-checker"; export="msmeComplianceChecker"; profile="scheduled"; desc="Daily scan: invoices where (today - invoiceDate) >= min(45, paymentTermsDays) AND status != PAID. Triggers MSME_COMPLIANCE_NOTICE with statutory language + MSME certificate attachment." }
  @{ dir="invoice-confirmation-scheduler"; export="invoiceConfirmationScheduler"; profile="default"; desc="On invoice SENT: schedule Day 3 request, Day 7 followup, Day 10 auto-acceptance emails via EventBridge." }
  @{ dir="daily-digest"; export="dailyDigest"; profile="scheduled"; desc="8 AM IST role-scoped digests (Admin/Logistics/Purchase/Sales variants) via SES template DAILY_DIGEST with role-specific sections injected." }
  @{ dir="depreciation-engine"; export="depreciationEngine"; profile="scheduled"; desc="Monthly depreciation run (1st @ 01:00 IST). Iterates ASSET UnitRecords, applies STRAIGHT_LINE or DECLINING_BALANCE using shared/depreciation.ts. Writes DepreciationRecord + updates currentBookValue." }
  @{ dir="hsn-validator"; export="hsnValidator"; profile="default"; desc="On-demand via AppSync. Format check (shared/hsn.ts) -> OpenSearch lookup -> Gemini 1.5 Pro Google Search grounding fallback. Returns {status, description, gstRate, tallyFormat, source_url}." }
  @{ dir="boq-parser"; export="boqParser"; profile="heavy"; desc="On-demand via AppSync. Parses BOQ .xlsx/.csv with SheetJS, runs fuzzy ProductMaster match, validates HSN codes via OpenSearch. Output: normalized line items ready for PO conversion." }
  @{ dir="chatbot-handler"; export="chatbotHandler"; profile="heavy"; desc="Gemini 1.5 Pro chatbot with OpenSearch RAG. Rate-limited 10 req/min/user via ChatSession. Supports inventory queries, HSN lookup with Google Search grounding, report generation (pre-signed S3 CSV link)." }
  @{ dir="tally-export-generator"; export="tallyExportGenerator"; profile="default"; desc="On-demand: generates TallyPrime XML for a GRN (Purchase Voucher) or DC (Sales / Delivery Note) using shared/tally.ts. Uploads to S3 private bucket under tally-exports/, returns pre-signed URL." }
  @{ dir="forex-rate-fetcher"; export="forexRateFetcher"; profile="default"; desc="On-demand fetch of USD/EUR/GBP -> INR from ExchangeRate-API. Caches in ForexRateCache table for 6 hours. Used by GRN + import cost estimator." }
  @{ dir="fy-rollover"; export="fyRollover"; profile="scheduled"; desc="Runs April 1 @ 00:01 IST. Resets FYSequenceCounter rows for new FY. Writes AuditLog. Rotates API key used by Client Portal." }
  @{ dir="tds-auto-creator"; export="tdsAutoCreator"; profile="scheduled"; desc="1st of every month: auto-creates a Bill row (billType=TDS, dueDate=7th of this month). Assigns to Admin. Reminder on 4th, escalation on 6th via alert-engine." }
  @{ dir="warranty-alert-monthly"; export="warrantyAlertMonthly"; profile="scheduled"; desc="1st monthly: warranty expiry digest email listing units expiring in next 90 days grouped by godown." }
  @{ dir="amc-renewal-checker"; export="amcRenewalChecker"; profile="scheduled"; desc="Daily: flags AMC contracts expiring in 45 days. Creates StockAlert + auto-suggests renewal PO to Admin via SES." }
)

$tpl_resource = @'
import { defineFunction } from "@aws-amplify/backend";

export const __EXPORT__ = defineFunction({
  name: "__DIR__",
  entry: "./handler.ts",
  runtime: 20,
  architecture: "arm64",
  timeoutSeconds: __TIMEOUT__,
  memoryMB: __MEM__,
  environment: { APP_ENV: process.env.APP_ENV ?? "dev" },
});
'@

$tpl_handler_default = @'
/**
 * __DIR__ — __DESC__
 *
 * TODO: full implementation in next iteration.
 */
import type { Handler } from "aws-lambda";

export const handler: Handler = async (event) => {
  console.info("[__DIR__] invoked", { event });
  return { ok: true };
};
'@

$tpl_handler_scheduled = @'
/**
 * __DIR__ — __DESC__
 *
 * TODO: full implementation in next iteration.
 */
import type { ScheduledHandler } from "aws-lambda";

export const handler: ScheduledHandler = async (event) => {
  console.info("[__DIR__] scheduled run", { time: event.time, appEnv: process.env.APP_ENV });
};
'@

foreach ($f in $functions) {
  $profile = $f.profile
  switch ($profile) {
    "default"   { $timeout = 30;  $mem = 512;  $htpl = $tpl_handler_default  }
    "scheduled" { $timeout = 300; $mem = 1024; $htpl = $tpl_handler_scheduled }
    "heavy"     { $timeout = 120; $mem = 1536; $htpl = $tpl_handler_default  }
  }

  $res = $tpl_resource.Replace("__EXPORT__", $f.export).Replace("__DIR__", $f.dir).Replace("__TIMEOUT__", "$timeout").Replace("__MEM__", "$mem")
  $han = $htpl.Replace("__DIR__", $f.dir).Replace("__DESC__", $f.desc)

  Set-Content -Path "amplify\functions\$($f.dir)\resource.ts" -Value $res -NoNewline:$false
  Set-Content -Path "amplify\functions\$($f.dir)\handler.ts"  -Value $han -NoNewline:$false
  Write-Host "Wrote $($f.dir)"
}

Write-Host ""
Write-Host "Done. $($functions.Count) function stub pairs generated."
