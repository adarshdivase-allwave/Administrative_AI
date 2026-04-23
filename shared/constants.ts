/**
 * System-wide constants — single source of truth, imported by backend and
 * (later) frontend. Do NOT add business logic here — keep this file type-only
 * + literal values.
 */

// --- User roles (Cognito groups) ---------------------------------------------
export const USER_ROLES = ["Admin", "Logistics", "Purchase", "Sales"] as const;
export type UserRole = (typeof USER_ROLES)[number];

// --- Inventory categories -----------------------------------------------------
export const INVENTORY_CATEGORIES = [
  "GENERAL_STOCK",
  "PROJECT",
  "DEMO",
  "STANDBY",
  "ASSET",
] as const;
export type InventoryCategory = (typeof INVENTORY_CATEGORIES)[number];

// --- Unit statuses ------------------------------------------------------------
export const UNIT_STATUSES = [
  "IN_STOCK",
  "ALLOCATED_TO_PROJECT",
  "ON_DEMO",
  "ON_STANDBY",
  "ASSET_IN_USE",
  "DISPATCHED",
  "IN_TRANSIT",
  "UNDER_REPAIR",
  "UNDER_SERVICE",
  "RETURNED",
  "DAMAGED",
  "RETIRED",
] as const;
export type UnitStatus = (typeof UNIT_STATUSES)[number];

// --- Stock alert levels (derived, never stored) ------------------------------
export const STOCK_ALERT_LEVELS = ["NORMAL", "LOW_STOCK", "OUT_OF_STOCK"] as const;
export type StockAlertLevel = (typeof STOCK_ALERT_LEVELS)[number];

// --- Conditions ---------------------------------------------------------------
export const UNIT_CONDITIONS = ["NEW", "GOOD", "FAIR", "DAMAGED"] as const;
export type UnitCondition = (typeof UNIT_CONDITIONS)[number];

// --- Currencies supported for import/GRN -------------------------------------
export const SUPPORTED_CURRENCIES = ["INR", "USD", "EUR", "GBP"] as const;
export type Currency = (typeof SUPPORTED_CURRENCIES)[number];

// --- HSN validation status ----------------------------------------------------
export const HSN_VALIDATION_STATUSES = [
  "VALID",
  "INVALID",
  "AI_SUGGESTED",
  "TALLY_VALIDATED",
] as const;
export type HsnValidationStatus = (typeof HSN_VALIDATION_STATUSES)[number];

// --- Product categories -------------------------------------------------------
export const PRODUCT_CATEGORIES = [
  "Display",
  "Audio",
  "Control System",
  "Cabling",
  "Networking",
  "Switcher",
  "Camera",
  "Conferencing",
  "Accessory",
  "Other",
] as const;
export type ProductCategory = (typeof PRODUCT_CATEGORIES)[number];

// --- Depreciation models ------------------------------------------------------
export const DEPRECIATION_MODELS = ["STRAIGHT_LINE", "DECLINING_BALANCE"] as const;
export type DepreciationModel = (typeof DEPRECIATION_MODELS)[number];

// --- DC / document types ------------------------------------------------------
export const DC_TYPES = ["PROJECT", "DEMO", "STANDBY", "ASSET"] as const;
export type DcType = (typeof DC_TYPES)[number];

export const DC_STATUSES = ["DRAFT", "DISPATCHED", "ACKNOWLEDGED", "CLOSED"] as const;
export type DcStatus = (typeof DC_STATUSES)[number];

// --- Bill types ---------------------------------------------------------------
export const BILL_TYPES = [
  "AMC_BILL",
  "ELECTRICITY",
  "TDS",
  "CREDIT_CARD",
  "TELEPHONE",
  "CUSTOM",
] as const;
export type BillType = (typeof BILL_TYPES)[number];

export const BILLING_CYCLES = ["MONTHLY", "QUARTERLY", "ANNUAL", "ONE_TIME"] as const;
export type BillingCycle = (typeof BILLING_CYCLES)[number];

export const BILL_STATUSES = ["PENDING", "INVOICE_CREATED", "PAID", "OVERDUE"] as const;
export type BillStatus = (typeof BILL_STATUSES)[number];

// --- Invoice statuses ---------------------------------------------------------
export const INVOICE_STATUSES = [
  "DRAFT",
  "SENT",
  "CONFIRMATION_PENDING",
  "CONFIRMED",
  "REMINDER_SENT",
  "DUE_TODAY",
  "OVERDUE",
  "MSME_NOTICE_SENT",
  "PAID",
  "CANCELLED",
  "DISPUTED",
] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

// --- India compliance defaults -----------------------------------------------
export const E_WAY_BILL_THRESHOLD_INR_DEFAULT = 50_000;
export const PO_APPROVAL_THRESHOLD_INR_DEFAULT = 50_000;
export const MSME_AUTO_TRIGGER_DAYS_DEFAULT = 45;
export const COGNITO_IDLE_TTL_SECONDS_DEFAULT = 1800;
export const CHATBOT_RATE_LIMIT_PER_MIN_DEFAULT = 10;
export const FOREX_CACHE_TTL_HOURS = 6;
export const PRESIGNED_URL_TTL_SECONDS = 15 * 60; // 15 min
export const TDS_DUE_DAY_OF_MONTH = 7;
export const TDS_REMINDER_DAY_OF_MONTH = 4;
export const TDS_ESCALATION_DAY_OF_MONTH = 6;

// --- Time zones ---------------------------------------------------------------
export const INDIA_TIMEZONE = "Asia/Kolkata";

// --- Financial year (India) ---------------------------------------------------
export const FY_START_MONTH_INDEX = 3; // April (0-indexed: Jan=0)
export const FY_START_DAY = 1;

// --- MSME classifications -----------------------------------------------------
export const MSME_CLASSIFICATIONS = ["MICRO", "SMALL", "MEDIUM"] as const;
export type MsmeClassification = (typeof MSME_CLASSIFICATIONS)[number];

// --- HSN sources --------------------------------------------------------------
export const HSN_CODE_SOURCES = [
  "MANUAL",
  "AI_LOOKUP",
  "VENDOR_INVOICE",
  "TALLY_VALIDATED",
] as const;
export type HsnCodeSource = (typeof HSN_CODE_SOURCES)[number];
