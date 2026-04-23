/**
 * Amplify Gen 2 data schema — 36 DynamoDB-backed models exposed via AppSync GraphQL.
 *
 * Authorization model (single source of truth):
 *   - Admin: full CRUD on every model, including financials
 *   - Logistics: create/update/read on GRN, DC, UnitRecord, Transfer, ServiceTicket
 *   - Purchase: create/update/read on PO, Vendor, BOQ, PO line items
 *   - Sales: read-only on Project/Client/UnitRecord; CRUD on ClientInvoice payment status
 *   - Public (no auth): ClientPortalToken-authenticated access handled separately
 *                       via Lambda resolvers (not expressed as @auth).
 *
 * Hardening (applied post-synth in `amplify/custom/dynamo-hardening.ts`):
 *   - PointInTimeRecoveryEnabled: true  (ALL tables)
 *   - SSESpecification.SSEEnabled: true  (ALL tables)
 *   - DeletionProtectionEnabled: true    (prod only — dev/staging keep it off)
 *
 * Key conventions:
 *   - All IDs are UUIDs; Amplify auto-generates them.
 *   - All monetary values are stored as Float in INR (2-decimal precision).
 *     Foreign amounts carry original currency + forex rate (see UnitRecord).
 *   - Dates are ISO-8601 strings in UTC; IST conversion happens client-side
 *     and in Lambdas via shared/fy.ts.
 *   - Every model has createdAt / updatedAt automatically from Amplify.
 */
import { a, defineData, type ClientSchema } from "@aws-amplify/backend";
import { hsnValidator } from "../functions/hsn-validator/resource.js";
import { forexRateFetcher } from "../functions/forex-rate-fetcher/resource.js";
import { chatbotHandler } from "../functions/chatbot-handler/resource.js";
import { tallyExportGenerator } from "../functions/tally-export-generator/resource.js";
import { invoiceScheduler } from "../functions/invoice-scheduler/resource.js";
import { invoiceConfirmationScheduler } from "../functions/invoice-confirmation-scheduler/resource.js";
import { boqParser } from "../functions/boq-parser/resource.js";
import { reminderDispatcher } from "../functions/reminder-dispatcher/resource.js";
import { userAdmin } from "../functions/user-admin/resource.js";
import { clientPortalHandler } from "../functions/client-portal-handler/resource.js";

// =============================================================================
// Schema
// =============================================================================
const schema = a
  .schema({
    // -------------------------------------------------------------------------
    // Master data
    // -------------------------------------------------------------------------

    /** Product catalog — one row per SKU. Individual units live in UnitRecord. */
    ProductMaster: a
      .model({
        productName: a.string().required(),
        brand: a.string(),
        category: a.enum([
          "Display",
          "Audio",
          "ControlSystem",
          "Cabling",
          "Networking",
          "Switcher",
          "Camera",
          "Conferencing",
          "Accessory",
          "Other",
        ]),
        modelNumber: a.string(),

        // HSN / GST
        hsnCode: a.string(),
        hsnCodeSource: a.enum(["MANUAL", "AI_LOOKUP", "VENDOR_INVOICE", "TALLY_VALIDATED"]),
        hsnTallyFormat: a.string(),
        hsnCodeVerifiedAt: a.datetime(),
        hsnTallyCompatible: a.boolean(),
        gstRatePercent: a.float(),

        specifications: a.json(),
        unitOfMeasure: a.string().default("Nos"),

        // Pricing (INR)
        sellingPrice: a.float(),
        sellingPriceExGST: a.float(),
        purchasePriceAverage: a.float(),

        // Stock thresholds
        lowStockThreshold: a.integer().default(0),
        reorderQuantity: a.integer().default(0),

        // Import
        importRequired: a.boolean().default(false),
        importLeadTimeDays: a.integer(),
        countryOfOrigin: a.string(),
        customsDutyPercent: a.float(),

        // Vendors
        vendorIds: a.string().array(),
        preferredVendorId: a.id(),

        // Assets
        images: a.string().array(), // S3 keys

        // Service
        warrantyPeriodMonths: a.integer(),
        amcEligible: a.boolean().default(false),

        // Physical
        weightKg: a.float(),
        dimensionsLxWxHCm: a.string(),

        // Relations
        units: a.hasMany("UnitRecord", "productId"),
      })
      .authorization((allow) => [
        allow.group("Admin").to(["create", "update", "delete", "read"]),
        allow.groups(["Logistics", "Purchase"]).to(["create", "update", "read"]),
        allow.group("Sales").to(["read"]),
      ]),

    /** Every physical unit in the system — one row per serial number. */
    UnitRecord: a
      .model({
        productId: a.id().required(),
        product: a.belongsTo("ProductMaster", "productId"),
        serialNumber: a.string().required(),
        qrCodeLabel: a.string(), // full URL https://[domain]/unit/[unitId]

        // Stored as strings (not a.enum) so they can be GSI sort keys.
        // Values are constrained at the resolver layer via shared/constants.ts.
        inventoryCategory: a.string().required(),
        status: a.string().required(),
        condition: a.enum(["NEW", "GOOD", "FAIR", "DAMAGED"]),

        // Location
        godownId: a.id(),
        godown: a.belongsTo("Godown", "godownId"),
        godownLocation: a.string(), // e.g. "A3-S2"

        // Purchase / acquisition (financial — Admin-only read in field resolvers)
        purchasePrice: a.float(),
        purchasePriceForeignCurrency: a.float(),
        purchaseCurrency: a.enum(["INR", "USD", "EUR", "GBP"]),
        forexRateAtPurchase: a.float(),
        purchaseDate: a.datetime(),

        vendorId: a.id(),
        vendor: a.belongsTo("Vendor", "vendorId"),
        grnId: a.id(),
        grn: a.belongsTo("GoodsReceivedNote", "grnId"),

        // HSN (cached per unit for audit)
        hsnCode: a.string(),
        hsnTallyFormat: a.string(),
        hsnValidationStatus: a.enum(["VALID", "INVALID", "AI_SUGGESTED", "TALLY_VALIDATED"]),

        // Allocation
        currentProjectId: a.id(),
        currentProject: a.belongsTo("Project", "currentProjectId"),
        currentDemoId: a.id(),
        currentDemo: a.belongsTo("DemoRecord", "currentDemoId"),

        // Warranty / AMC / service
        warrantyExpiryDate: a.date(),
        amcContractId: a.id(),
        amcContract: a.belongsTo("AMCContract", "amcContractId"),
        lastServiceDate: a.date(),
        nextServiceDueDate: a.date(),
        insuranceExpiryDate: a.date(),

        // Asset-only fields (ignored when inventoryCategory ≠ ASSET)
        depreciationModel: a.enum(["STRAIGHT_LINE", "DECLINING_BALANCE"]),
        usefulLifeYears: a.integer(),
        salvageValue: a.float(),
        currentBookValue: a.float(),
        assetTag: a.string(),
        assetDepartment: a.string(),
        assetCustodian: a.string(),

        // Admin-defined custom fields per category
        customFields: a.json(),

        notes: a.string(),
        images: a.string().array(),

        createdByUserId: a.id(),
        lastUpdatedByUserId: a.id(),
      })
      /**
       * 8 GSIs matching spec §23:
       *   serialNumber-index, productId-status, productId-category,
       *   godownId-status, currentProjectId, vendorId,
       *   warrantyExpiryDate, nextServiceDueDate
       */
      .secondaryIndexes((idx) => [
        idx("serialNumber"),
        idx("productId").sortKeys(["status"]),
        idx("productId").sortKeys(["inventoryCategory"]),
        idx("godownId").sortKeys(["status"]),
        idx("currentProjectId"),
        idx("vendorId"),
        idx("warrantyExpiryDate"),
        idx("nextServiceDueDate"),
      ])
      .authorization((allow) => [
        allow.group("Admin").to(["create", "update", "delete", "read"]),
        allow.group("Logistics").to(["create", "update", "read"]),
        allow.groups(["Purchase", "Sales"]).to(["read"]),
      ]),

    Godown: a
      .model({
        name: a.string().required(),
        addressLine1: a.string(),
        addressLine2: a.string(),
        city: a.string(),
        state: a.string(),
        pincode: a.string(),
        manager: a.string(),
        phone: a.string(),
        rackGrid: a.json(), // Admin-defined rack/shelf grid
        units: a.hasMany("UnitRecord", "godownId"),
      })
      .authorization((allow) => [
        allow.group("Admin").to(["create", "update", "delete", "read"]),
        allow.authenticated().to(["read"]),
      ]),

    Vendor: a
      .model({
        name: a.string().required(),
        gstin: a.string(),
        stateCode: a.string(),
        pan: a.string(),
        contactName: a.string(),
        contactEmail: a.email(),
        contactPhone: a.string(),
        addressLine1: a.string(),
        addressLine2: a.string(),
        city: a.string(),
        state: a.string(),
        pincode: a.string(),
        msmeRegistered: a.boolean().default(false),
        msmeUdyamNumber: a.string(),
        tallyLedgerName: a.string(), // as it appears in TallyPrime
        paymentTermsDays: a.integer(),
        isActive: a.boolean().default(true),
        notes: a.string(),
        units: a.hasMany("UnitRecord", "vendorId"),
        purchaseOrders: a.hasMany("PurchaseOrder", "vendorId"),
      })
      .authorization((allow) => [
        allow.group("Admin").to(["create", "update", "delete", "read"]),
        allow.groups(["Purchase", "Logistics"]).to(["create", "update", "read"]),
        allow.group("Sales").to(["read"]),
      ]),

    Client: a
      .model({
        name: a.string().required(),
        gstin: a.string(),
        stateCode: a.string(),
        pan: a.string(),
        contactName: a.string(),
        contactEmail: a.email(),
        billingEmail: a.email(),
        contactPhone: a.string(),
        billingAddressLine1: a.string(),
        billingAddressLine2: a.string(),
        billingCity: a.string(),
        billingState: a.string(),
        billingPincode: a.string(),
        tallyLedgerName: a.string(),
        paymentTermsDays: a.integer().default(30),
        isActive: a.boolean().default(true),
        projects: a.hasMany("Project", "clientId"),
        invoices: a.hasMany("ClientInvoice", "clientId"),
      })
      .authorization((allow) => [
        allow.group("Admin").to(["create", "update", "delete", "read"]),
        allow.groups(["Sales", "Logistics"]).to(["create", "update", "read"]),
        allow.group("Purchase").to(["read"]),
      ]),

    Project: a
      .model({
        projectName: a.string().required(),
        clientId: a.id().required(),
        client: a.belongsTo("Client", "clientId"),
        projectCode: a.string(),
        siteAddressLine1: a.string(),
        siteAddressLine2: a.string(),
        siteCity: a.string(),
        siteState: a.string(),
        sitePincode: a.string(),
        projectManagerUserId: a.id(),
        salespersonUserId: a.id(),
        startDate: a.date(),
        expectedEndDate: a.date(),
        actualEndDate: a.date(),
        status: a.enum(["PLANNING", "IN_PROGRESS", "ON_HOLD", "COMPLETED", "CANCELLED"]),
        notes: a.string(),
        units: a.hasMany("UnitRecord", "currentProjectId"),
        invoices: a.hasMany("ClientInvoice", "projectId"),
      })
      .authorization((allow) => [
        allow.group("Admin").to(["create", "update", "delete", "read"]),
        allow.group("Logistics").to(["create", "update", "read"]),
        allow.groups(["Sales", "Purchase"]).to(["read"]),
      ]),

    /** OpenSearch also holds this; DynamoDB is the source of truth. */
    HSNDatabase: a
      .model({
        hsnCode: a.string().required(),
        description: a.string().required(),
        gstRatePercent: a.float(),
        cgstRatePercent: a.float(),
        sgstRatePercent: a.float(),
        igstRatePercent: a.float(),
        effectiveDate: a.date(),
        chapter: a.string(),
        section: a.string(),
        isSac: a.boolean().default(false),
        notes: a.string(),
      })
      .secondaryIndexes((idx) => [idx("hsnCode")])
      .authorization((allow) => [
        allow.group("Admin").to(["create", "update", "delete", "read"]),
        allow.authenticated().to(["read"]),
      ]),

    // -------------------------------------------------------------------------
    // Inbound / outbound movement
    // -------------------------------------------------------------------------

    GoodsReceivedNote: a
      .model({
        grnNumber: a.string().required(), // GRN-2526-00001
        grnDate: a.datetime().required(),
        vendorId: a.id().required(),
        vendorGstin: a.string(),
        poId: a.id(),
        vendorInvoiceNumber: a.string(),
        vendorInvoiceDate: a.date(),
        vendorInvoicePdfS3Key: a.string(),
        currency: a.enum(["INR", "USD", "EUR", "GBP"]),
        forexRateAtGrn: a.float(),

        totalValueForeign: a.float(),
        totalValueInr: a.float(),
        totalGstInr: a.float(),
        intrastate: a.boolean(),

        // Populated after Tally export is generated
        tallyXmlS3Key: a.string(),
        tallyExportedAt: a.datetime(),

        notes: a.string(),
        createdByUserId: a.id(),
        units: a.hasMany("UnitRecord", "grnId"),
      })
      .secondaryIndexes((idx) => [idx("grnNumber"), idx("vendorId").sortKeys(["grnDate"])])
      .authorization((allow) => [
        allow.group("Admin").to(["create", "update", "delete", "read"]),
        allow.group("Logistics").to(["create", "update", "read"]),
        allow.groups(["Purchase", "Sales"]).to(["read"]),
      ]),

    DeliveryChallan: a
      .model({
        dcNumber: a.string().required(), // DC-2526-00001
        dcDate: a.datetime().required(),
        dcType: a.string().required(), // "PROJECT" | "DEMO" | "STANDBY" | "ASSET"
        projectId: a.id(),
        demoRecordId: a.id(),
        clientId: a.id(),

        deliveryAddressLine1: a.string(),
        deliveryAddressLine2: a.string(),
        deliveryCity: a.string(),
        deliveryState: a.string(),
        deliveryPincode: a.string(),
        placeOfSupplyStateCode: a.string(),

        transporterName: a.string(),
        vehicleNumber: a.string(),
        lrDocketNumber: a.string(),

        eWayBillNumber: a.string(),
        eWayBillRequired: a.boolean(),

        totalValueInr: a.float(),
        totalGstInr: a.float(),
        intrastate: a.boolean(),

        status: a.enum(["DRAFT", "DISPATCHED", "ACKNOWLEDGED", "CLOSED"]),

        tallyXmlS3Key: a.string(),
        tallyExportedAt: a.datetime(),
        pdfS3Key: a.string(),
        emailedToClientAt: a.datetime(),

        notes: a.string(),
        createdByUserId: a.id(),

        lineItems: a.hasMany("DispatchLineItem", "deliveryChallanId"),
      })
      .secondaryIndexes((idx) => [
        idx("dcNumber"),
        idx("clientId").sortKeys(["dcDate"]),
        idx("projectId").sortKeys(["dcDate"]),
      ])
      .authorization((allow) => [
        allow.group("Admin").to(["create", "update", "delete", "read"]),
        allow.group("Logistics").to(["create", "update", "read"]),
        allow.groups(["Sales", "Purchase"]).to(["read"]),
      ]),

    DispatchLineItem: a
      .model({
        deliveryChallanId: a.id().required(),
        deliveryChallan: a.belongsTo("DeliveryChallan", "deliveryChallanId"),
        unitId: a.id().required(),
        productName: a.string(),
        modelNumber: a.string(),
        hsnTallyFormat: a.string(),
        unitPriceInr: a.float(),
        gstRatePercent: a.float(),
      })
      .authorization((allow) => [
        allow.group("Admin").to(["create", "update", "delete", "read"]),
        allow.group("Logistics").to(["create", "update", "read"]),
        allow.groups(["Sales", "Purchase"]).to(["read"]),
      ]),

    ReturnRecord: a
      .model({
        returnNumber: a.string(),
        returnDate: a.datetime(),
        dcId: a.id(),
        unitId: a.id(),
        condition: a.enum(["NEW", "GOOD", "FAIR", "DAMAGED"]),
        notes: a.string(),
        receivedByUserId: a.id(),
      })
      .authorization((allow) => [
        allow.group("Admin").to(["create", "update", "delete", "read"]),
        allow.group("Logistics").to(["create", "update", "read"]),
        allow.authenticated().to(["read"]),
      ]),

    TransferOrder: a
      .model({
        transferNumber: a.string(),
        sourceGodownId: a.id().required(),
        destinationGodownId: a.id().required(),
        transporterName: a.string(),
        vehicleNumber: a.string(),
        lrDocketNumber: a.string(),
        dispatchedAt: a.datetime(),
        receivedAt: a.datetime(),
        status: a.enum(["DRAFT", "IN_TRANSIT", "RECEIVED", "CANCELLED"]),
        unitIds: a.id().array(),
        notes: a.string(),
        createdByUserId: a.id(),
      })
      .authorization((allow) => [
        allow.group("Admin").to(["create", "update", "delete", "read"]),
        allow.group("Logistics").to(["create", "update", "read"]),
        allow.authenticated().to(["read"]),
      ]),

    DemoRecord: a
      .model({
        demoNumber: a.string(),
        clientId: a.id().required(),
        staffUserId: a.id(),
        scheduledDate: a.date(),
        expectedReturnDate: a.date(),
        actualReturnDate: a.date(),
        status: a.enum(["SCHEDULED", "IN_PROGRESS", "RETURNED", "CONVERTED_TO_SALE"]),
        notes: a.string(),
        units: a.hasMany("UnitRecord", "currentDemoId"),
      })
      .authorization((allow) => [
        allow.group("Admin").to(["create", "update", "delete", "read"]),
        allow.groups(["Logistics", "Sales"]).to(["create", "update", "read"]),
        allow.group("Purchase").to(["read"]),
      ]),

    // -------------------------------------------------------------------------
    // Service / AMC
    // -------------------------------------------------------------------------

    ServiceTicket: a
      .model({
        ticketNumber: a.string(),
        unitId: a.id().required(),
        reportedByUserId: a.id(),
        assignedToUserId: a.id(),
        reportedAt: a.datetime(),
        issue: a.string(),
        diagnosis: a.string(),
        resolution: a.string(),
        status: a.enum(["OPEN", "IN_PROGRESS", "RESOLVED", "CANCELLED"]),
        costInr: a.float(),
        resolvedAt: a.datetime(),
        attachmentS3Keys: a.string().array(),
      })
      .authorization((allow) => [
        allow.group("Admin").to(["create", "update", "delete", "read"]),
        allow.group("Logistics").to(["create", "update", "read"]),
        allow.authenticated().to(["read"]),
      ]),

    AMCContract: a
      .model({
        contractNumber: a.string(),
        vendorId: a.id(),
        startDate: a.date().required(),
        endDate: a.date().required(),
        annualCostInr: a.float(),
        coverage: a.string(),
        renewalReminderSentAt: a.datetime(),
        status: a.enum(["ACTIVE", "EXPIRED", "RENEWED", "CANCELLED"]),
        notes: a.string(),
        units: a.hasMany("UnitRecord", "amcContractId"),
      })
      .authorization((allow) => [
        allow.group("Admin").to(["create", "update", "delete", "read"]),
        allow.groups(["Logistics", "Purchase"]).to(["read"]),
      ]),

    // -------------------------------------------------------------------------
    // Finance / compliance
    // -------------------------------------------------------------------------

    ClientInvoice: a
      .model({
        invoiceNumber: a.string().required(), // GST-format INV-2526-00001, max 16 chars
        invoiceDate: a.date().required(),
        clientId: a.id().required(),
        client: a.belongsTo("Client", "clientId"),
        projectId: a.id(),
        project: a.belongsTo("Project", "projectId"),
        salespersonUserId: a.id(),

        amountDueInr: a.float().required(),
        cgstInr: a.float(),
        sgstInr: a.float(),
        igstInr: a.float(),
        totalAmountInr: a.float().required(),

        paymentTermsDays: a.integer().default(30),
        dueDate: a.date().required(),

        invoicePdfS3Key: a.string(),
        status: a.string().required(), // see shared/constants.ts INVOICE_STATUSES
        paidAt: a.datetime(),
        paidAmountInr: a.float(),
        paymentReference: a.string(),

        msmeNoticeSentAt: a.datetime(),
        fyYear: a.string(), // "2025-26"

        reminderLogs: a.hasMany("PaymentReminderLog", "invoiceId"),
        msmeLogs: a.hasMany("MSMEComplianceLog", "invoiceId"),
        confirmations: a.hasMany("InvoiceConfirmation", "invoiceId"),
      })
      .secondaryIndexes((idx) => [
        idx("invoiceNumber"),
        idx("clientId").sortKeys(["dueDate"]),
        idx("status").sortKeys(["dueDate"]),
        idx("fyYear").sortKeys(["invoiceDate"]),
      ])
      .authorization((allow) => [
        allow.group("Admin").to(["create", "update", "delete", "read"]),
        allow.group("Sales").to(["create", "update", "read"]),
        allow.groups(["Logistics", "Purchase"]).to(["read"]),
      ]),

    PaymentReminderLog: a
      .model({
        invoiceId: a.id().required(),
        invoice: a.belongsTo("ClientInvoice", "invoiceId"),
        stage: a.string().required(), // PAYMENT_REMINDER_STAGES (see shared)
        sentAt: a.datetime().required(),
        channel: a.enum(["EMAIL", "IN_APP", "BOTH"]),
        recipientEmails: a.string().array(),
        sesMessageId: a.string(),
        templateUsed: a.string(),
      })
      .authorization((allow) => [
        allow.group("Admin").to(["create", "update", "delete", "read"]),
        allow.group("Sales").to(["read"]),
        allow.authenticated().to(["read"]),
      ]),

    MSMEComplianceLog: a
      .model({
        invoiceId: a.id().required(),
        invoice: a.belongsTo("ClientInvoice", "invoiceId"),
        sentAt: a.datetime().required(),
        daysOverdue: a.integer(),
        recipientEmails: a.string().array(),
        templateUsed: a.string(),
        sesMessageId: a.string(),
        adminApprovedByUserId: a.id(),
        adminApprovedAt: a.datetime(),
        certificateAttachedS3Key: a.string(),
      })
      .authorization((allow) => [
        allow.group("Admin").to(["create", "update", "delete", "read"]),
        allow.group("Sales").to(["read"]),
      ]),

    InvoiceConfirmation: a
      .model({
        invoiceId: a.id().required(),
        invoice: a.belongsTo("ClientInvoice", "invoiceId"),
        stage: a.enum(["D_3_REQUEST", "D_7_FOLLOWUP", "D_10_AUTO_ACCEPTANCE", "CONFIRMED"]),
        sentAt: a.datetime(),
        confirmedAt: a.datetime(),
        confirmationToken: a.string(),
        status: a.enum(["PENDING", "CONFIRMED", "AUTO_ACCEPTED"]),
      })
      .authorization((allow) => [
        allow.group("Admin").to(["create", "update", "delete", "read"]),
        allow.group("Sales").to(["read"]),
      ]),

    Bill: a
      .model({
        billType: a.string().required(), // see shared/constants.ts BILL_TYPES
        description: a.string().required(),
        vendorOrAuthority: a.string(),
        billingCycle: a.enum(["MONTHLY", "QUARTERLY", "ANNUAL", "ONE_TIME"]),
        dueDate: a.datetime().required(),
        recurringDayOfMonth: a.integer(),
        reminderDaysBefore: a.integer().default(3),
        assignedToUserId: a.id(),
        status: a.enum(["PENDING", "INVOICE_CREATED", "PAID", "OVERDUE"]),
        amountInr: a.float(),
        attachmentS3Key: a.string(),
        notes: a.string(),
        fyYear: a.string(),
        paidAt: a.datetime(),
        remindersSent: a.hasMany("BillReminderLog", "billId"),
      })
      .secondaryIndexes((idx) => [
        idx("billType").sortKeys(["dueDate"]),
        idx("status").sortKeys(["dueDate"]),
        idx("fyYear").sortKeys(["dueDate"]),
      ])
      .authorization((allow) => [
        allow.group("Admin").to(["create", "update", "delete", "read"]),
        allow.authenticated().to(["read"]),
      ]),

    BillReminderLog: a
      .model({
        billId: a.id().required(),
        bill: a.belongsTo("Bill", "billId"),
        stage: a.enum(["REMINDER", "OVERDUE_ALERT", "TDS_D4", "TDS_D6_ESCALATION"]),
        sentAt: a.datetime().required(),
        recipientUserIds: a.id().array(),
        sesMessageId: a.string(),
      })
      .authorization((allow) => [
        allow.group("Admin").to(["create", "update", "delete", "read"]),
      ]),

    DepreciationRecord: a
      .model({
        unitId: a.id().required(),
        runDate: a.date().required(), // 1st of month
        fyYear: a.string(),
        method: a.enum(["STRAIGHT_LINE", "DECLINING_BALANCE"]),
        monthlyDepreciationInr: a.float(),
        accumulatedDepreciationInr: a.float(),
        bookValueBeforeInr: a.float(),
        bookValueAfterInr: a.float(),
        hasReachedSalvage: a.boolean(),
      })
      .secondaryIndexes((idx) => [
        idx("unitId").sortKeys(["runDate"]),
        idx("fyYear").sortKeys(["runDate"]),
      ])
      .authorization((allow) => [
        allow.group("Admin").to(["create", "update", "delete", "read"]),
      ]),

    /**
     * Single-row-ish config table (partition key = "GLOBAL").
     * Admin edits here flow to every Lambda that reads settings.
     */
    SystemSettings: a
      .model({
        // Company identity
        companyName: a.string(),
        companyGstin: a.string(),
        companyStateCode: a.string(),
        companyAddressLine1: a.string(),
        companyAddressLine2: a.string(),
        companyCity: a.string(),
        companyState: a.string(),
        companyPincode: a.string(),
        companyOpsEmail: a.email(),
        companyLogoS3Key: a.string(),
        companyLogoPublicUrl: a.string(),

        // Numbering prefixes
        invoicePrefix: a.string().default("INV"),
        dcPrefix: a.string().default("DC"),
        grnPrefix: a.string().default("GRN"),
        poPrefix: a.string().default("PO"),

        // Compliance thresholds
        eWayBillThresholdInr: a.float().default(50000),
        poApprovalThresholdInr: a.float().default(50000),
        cognitoIdleSessionTtlSeconds: a.integer().default(1800),

        // MSME
        msmeEnabled: a.boolean().default(true),
        msmeUdyamRegistrationNumber: a.string(),
        msmeCertificateS3Key: a.string(),
        msmeEnterpriseClassification: a.enum(["MICRO", "SMALL", "MEDIUM"]),
        msmeRequireAdminApproval: a.boolean().default(false),
        msmeAutoTriggerDays: a.integer().default(45),

        // Tally ledger mappings (for XML export)
        tallyPurchaseLedgerName: a.string(),
        tallySalesLedgerName: a.string(),
        tallyCgstLedgerName: a.string(),
        tallySgstLedgerName: a.string(),
        tallyIgstLedgerName: a.string(),
        tallyVendorNameMap: a.json(),
        tallyClientNameMap: a.json(),

        // Chatbot
        chatbotRateLimitPerMin: a.integer().default(10),

        // SES
        sesFromEmail: a.email(),
        sesReplyTo: a.email(),
        sesConfigurationSet: a.string(),

        // Admin-editable misc
        dcPriceSource: a.string().default("SELLING_PRICE"), // "PURCHASE_PRICE" | "SELLING_PRICE"
      })
      .authorization((allow) => [
        allow.group("Admin").to(["create", "update", "delete", "read"]),
        allow.authenticated().to(["read"]),
      ]),

    /** Atomic counter for PREFIX+FY sequence numbering. */
    FYSequenceCounter: a
      .model({
        counterKey: a.string().required(), // e.g. "INVOICE#INV#2526"
        fyYear: a.string().required(),
        prefix: a.string(),
        documentKind: a.enum(["INVOICE", "DC", "GRN", "PO"]),
        lastSequence: a.integer().required().default(0),
        lastAllocatedAt: a.datetime(),
      })
      .secondaryIndexes((idx) => [idx("counterKey")])
      .authorization((allow) => [
        allow.group("Admin").to(["read", "update"]),
        allow.authenticated().to(["read"]),
      ]),

    ForexRateCache: a
      .model({
        baseCurrency: a.string().required(),
        quoteCurrency: a.string().required(),
        rate: a.float().required(),
        fetchedAt: a.datetime().required(),
        expiresAt: a.datetime().required(),
        source: a.string().default("exchangerate-api"),
      })
      .authorization((allow) => [
        allow.group("Admin").to(["create", "update", "delete", "read"]),
        allow.authenticated().to(["read"]),
      ]),

    // -------------------------------------------------------------------------
    // Procurement
    // -------------------------------------------------------------------------

    PurchaseOrder: a
      .model({
        poNumber: a.string().required(), // PO-2526-00001
        poDate: a.datetime().required(),
        vendorId: a.id().required(),
        vendor: a.belongsTo("Vendor", "vendorId"),
        totalValueInr: a.float(),
        currency: a.enum(["INR", "USD", "EUR", "GBP"]),
        importCostEstimate: a.json(),
        approvalStatus: a.enum(["AUTO_APPROVED", "PENDING_APPROVAL", "APPROVED", "REJECTED"]),
        approvedByUserId: a.id(),
        approvedAt: a.datetime(),
        rejectionReason: a.string(),
        status: a.enum(["DRAFT", "SENT_TO_VENDOR", "PARTIALLY_RECEIVED", "RECEIVED", "CANCELLED"]),
        expectedDeliveryDate: a.date(),
        sentToVendorAt: a.datetime(),
        pdfS3Key: a.string(),
        notes: a.string(),
        createdByUserId: a.id(),
        lineItems: a.hasMany("POLineItem", "poId"),
      })
      .secondaryIndexes((idx) => [
        idx("poNumber"),
        idx("vendorId").sortKeys(["poDate"]),
        idx("status").sortKeys(["poDate"]),
      ])
      .authorization((allow) => [
        allow.group("Admin").to(["create", "update", "delete", "read"]),
        allow.group("Purchase").to(["create", "update", "read"]),
        allow.groups(["Logistics", "Sales"]).to(["read"]),
      ]),

    POLineItem: a
      .model({
        poId: a.id().required(),
        po: a.belongsTo("PurchaseOrder", "poId"),
        productId: a.id(),
        productName: a.string(),
        hsnCode: a.string(),
        quantity: a.integer().required(),
        unitPrice: a.float(),
        unitCurrency: a.enum(["INR", "USD", "EUR", "GBP"]),
        unitPriceInr: a.float(),
        lineTotalInr: a.float(),
        receivedQuantity: a.integer().default(0),
        notes: a.string(),
      })
      .authorization((allow) => [
        allow.group("Admin").to(["create", "update", "delete", "read"]),
        allow.group("Purchase").to(["create", "update", "read"]),
        allow.groups(["Logistics", "Sales"]).to(["read"]),
      ]),

    BOQUpload: a
      .model({
        fileName: a.string().required(),
        s3Key: a.string().required(),
        uploadedByUserId: a.id(),
        uploadedAt: a.datetime(),
        projectId: a.id(),
        status: a.enum(["UPLOADED", "PARSED", "CONVERTED_TO_PO", "REJECTED"]),
        parsedLineCount: a.integer(),
        unmatchedLineCount: a.integer(),
        columnMapping: a.json(),
        notes: a.string(),
      })
      .authorization((allow) => [
        allow.group("Admin").to(["create", "update", "delete", "read"]),
        allow.group("Purchase").to(["create", "update", "read"]),
      ]),

    // -------------------------------------------------------------------------
    // Alerts / reminders / audit
    // -------------------------------------------------------------------------

    StockAlert: a
      .model({
        alertType: a.string().required(), // see shared/constants.ts alert types
        severity: a.enum(["INFO", "WARNING", "CRITICAL"]),
        productId: a.id(),
        unitId: a.id(),
        projectId: a.id(),
        message: a.string(),
        generatedAt: a.datetime().required(),
        acknowledgedByUserId: a.id(),
        acknowledgedAt: a.datetime(),
        /**
         * Stored as string ("TRUE"/"FALSE") rather than boolean so we can
         * GSI-index it — DynamoDB booleans aren't valid key attribute types.
         * Set by Lambda on create (default "TRUE") and flipped to "FALSE"
         * when an alert is acknowledged or auto-resolved.
         */
        isActive: a.string().default("TRUE"),
      })
      .secondaryIndexes((idx) => [
        idx("alertType").sortKeys(["generatedAt"]),
        idx("isActive").sortKeys(["generatedAt"]),
      ])
      .authorization((allow) => [
        allow.group("Admin").to(["create", "update", "delete", "read"]),
        allow.authenticated().to(["read", "update"]),
      ]),

    Reminder: a
      .model({
        userId: a.id().required(),
        title: a.string().required(),
        body: a.string(),
        remindAt: a.datetime().required(),
        recurring: a.boolean().default(false),
        cronExpression: a.string(), // if recurring
        eventBridgeScheduleArn: a.string(),
        status: a.enum(["ACTIVE", "COMPLETED", "CANCELLED"]),
        relatedEntityType: a.string(),
        relatedEntityId: a.id(),
        logs: a.hasMany("ReminderLog", "reminderId"),
      })
      .secondaryIndexes((idx) => [idx("userId").sortKeys(["remindAt"])])
      .authorization((allow) => [
        allow.group("Admin").to(["create", "update", "delete", "read"]),
        allow.authenticated().to(["create", "update", "delete", "read"]),
      ]),

    ReminderLog: a
      .model({
        reminderId: a.id().required(),
        reminder: a.belongsTo("Reminder", "reminderId"),
        firedAt: a.datetime().required(),
        channel: a.enum(["EMAIL", "IN_APP", "BOTH"]),
        sesMessageId: a.string(),
      })
      .authorization((allow) => [
        allow.group("Admin").to(["create", "update", "delete", "read"]),
        allow.authenticated().to(["read"]),
      ]),

    /** Append-only audit log. No role has DeleteItem permission. */
    AuditLog: a
      .model({
        actorUserId: a.id(),
        actorRole: a.enum(["Admin", "Logistics", "Purchase", "Sales", "SYSTEM"]),
        action: a.string().required(),
        entityType: a.string().required(),
        entityId: a.id(),
        before: a.json(),
        after: a.json(),
        ip: a.string(),
        userAgent: a.string(),
        occurredAt: a.datetime().required(),
      })
      .secondaryIndexes((idx) => [
        idx("actorUserId").sortKeys(["occurredAt"]),
        idx("entityType").sortKeys(["occurredAt"]),
      ])
      .authorization((allow) => [
        // Explicitly no delete grants anywhere — table is append-only.
        allow.group("Admin").to(["read"]),
        allow.authenticated().to(["create"]),
      ]),

    // -------------------------------------------------------------------------
    // Collaboration
    // -------------------------------------------------------------------------

    Comment: a
      .model({
        authorUserId: a.id().required(),
        body: a.string().required(),
        entityType: a.string().required(),
        entityId: a.id().required(),
        mentionedUserIds: a.id().array(),
      })
      .secondaryIndexes((idx) => [idx("entityType").sortKeys(["entityId"])])
      .authorization((allow) => [
        allow.group("Admin").to(["create", "update", "delete", "read"]),
        allow.authenticated().to(["create", "update", "read"]),
      ]),

    /** Real-time activity feed — AppSync subscriptions listen here. */
    ActivityFeed: a
      .model({
        eventType: a.string().required(), // e.g. "GRN_CREATED", "DC_DISPATCHED"
        actorUserId: a.id(),
        entityType: a.string(),
        entityId: a.id(),
        summary: a.string(),
        payload: a.json(),
        occurredAt: a.datetime().required(),
      })
      .secondaryIndexes((idx) => [idx("eventType").sortKeys(["occurredAt"])])
      .authorization((allow) => [
        allow.group("Admin").to(["create", "update", "delete", "read"]),
        allow.authenticated().to(["create", "read"]),
      ]),

    // -------------------------------------------------------------------------
    // Chatbot / client portal
    // -------------------------------------------------------------------------

    ChatSession: a
      .model({
        userId: a.id().required(),
        startedAt: a.datetime().required(),
        lastMessageAt: a.datetime(),
        messages: a.json(), // [{role, content, sourceUrls[], ts}]
        ratelimitWindowStart: a.datetime(),
        messagesInWindow: a.integer().default(0),
      })
      .secondaryIndexes((idx) => [idx("userId").sortKeys(["startedAt"])])
      .authorization((allow) => [
        allow.group("Admin").to(["create", "update", "delete", "read"]),
        allow.authenticated().to(["create", "update", "read"]),
      ]),

    ClientPortalToken: a
      .model({
        projectId: a.id().required(),
        token: a.string().required(),
        issuedByUserId: a.id(),
        issuedAt: a.datetime().required(),
        expiresAt: a.datetime().required(),
        lastAccessedAt: a.datetime(),
        isRevoked: a.boolean().default(false),
      })
      .secondaryIndexes((idx) => [idx("token")])
      /**
       * Notice: no public/unauth access here. Portal access is served by a
       * dedicated Lambda resolver that validates the token outside of the
       * Cognito auth layer (see `functions/chatbot-handler` pattern).
       */
      .authorization((allow) => [
        allow.group("Admin").to(["create", "update", "delete", "read"]),
      ]),

    // =====================================================================
    // Custom operations — AppSync resolvers backed by Lambda.
    //
    // These are generated on the typed client as `api.mutations.xxx` and
    // `api.queries.xxx`, with full TypeScript inference on arguments +
    // return types. Every operation declares Cognito-group authorization
    // separately from its implementing Lambda.
    // =====================================================================

    /** HSN / SAC validation + AI fallback. Used by HSN Lookup Tool, GRN, BOQ. */
    validateHsn: a
      .mutation()
      .arguments({
        hsnCode: a.string(),
        productName: a.string(),
        productSpecs: a.string(),
      })
      .returns(
        a.customType({
          status: a.string().required(),
          hsnCode: a.string().required(),
          description: a.string().required(),
          gstRatePercent: a.float().required(),
          tallyFormat: a.string().required(),
          tallyCompatible: a.boolean().required(),
          isSac: a.boolean().required(),
          sourceUrl: a.string(),
          sourceDomain: a.string(),
          error: a.string(),
        }),
      )
      .handler(a.handler.function(hsnValidator))
      .authorization((allow) => [allow.authenticated()]),

    /** Live forex rate (6h DynamoDB cache). USD/EUR/GBP → INR only. */
    forexRate: a
      .query()
      .arguments({
        quoteCurrency: a.string().required(),
        forceRefresh: a.boolean(),
      })
      .returns(
        a.customType({
          baseCurrency: a.string().required(),
          quoteCurrency: a.string().required(),
          rate: a.float().required(),
          fetchedAt: a.datetime().required(),
          expiresAt: a.datetime().required(),
          cacheHit: a.boolean().required(),
          source: a.string().required(),
        }),
      )
      .handler(a.handler.function(forexRateFetcher))
      .authorization((allow) => [allow.authenticated()]),

    /** Gemini-backed assistant with RAG + rate limiting. */
    chatbotMessage: a
      .mutation()
      .arguments({
        userId: a.id().required(),
        message: a.string().required(),
        sessionId: a.id(),
        deepLinkEntityType: a.string(),
        deepLinkEntityId: a.id(),
      })
      .returns(
        a.customType({
          sessionId: a.id().required(),
          reply: a.string().required(),
          sourceCitations: a.json(),
          tokensUsed: a.integer(),
          rateLimited: a.boolean(),
        }),
      )
      .handler(a.handler.function(chatbotHandler))
      .authorization((allow) => [allow.authenticated()]),

    /** Generates TallyPrime XML for a GRN or DC. Admin only (financial). */
    generateTallyExport: a
      .mutation()
      .arguments({
        kind: a.string().required(), // "GRN" | "DC"
        grnId: a.id(),
        dcId: a.id(),
        voucherType: a.string(), // "Sales" | "Delivery Note"
      })
      .returns(
        a.customType({
          s3Key: a.string().required(),
          presignedUrl: a.string().required(),
          xmlSize: a.integer().required(),
          voucherCount: a.integer().required(),
          exportedAt: a.datetime().required(),
        }),
      )
      .handler(a.handler.function(tallyExportGenerator))
      .authorization((allow) => [allow.group("Admin")]),

    /** Creates / updates / cancels the 8-stage per-invoice reminder set. */
    scheduleInvoiceReminders: a
      .mutation()
      .arguments({
        action: a.string().required(), // "CREATE" | "UPDATE" | "CANCEL"
        invoiceId: a.id().required(),
      })
      .returns(
        a.customType({
          scheduled: a.integer().required(),
          deleted: a.integer().required(),
          stages: a.string().array(),
        }),
      )
      .handler(a.handler.function(invoiceScheduler))
      .authorization((allow) => [allow.groups(["Admin", "Sales"])]),

    /** Creates / fires / cancels the D3/D7/D10 confirmation sequence. */
    manageInvoiceConfirmation: a
      .mutation()
      .arguments({
        mode: a.string().required(), // "CREATE" | "FIRE_STAGE" | "CANCEL"
        invoiceId: a.id().required(),
        stage: a.string(),
      })
      .returns(
        a.customType({
          action: a.string().required(),
        }),
      )
      .handler(a.handler.function(invoiceConfirmationScheduler))
      .authorization((allow) => [allow.groups(["Admin", "Sales"])]),

    /** Parses a BOQ .xlsx / .csv and returns normalized line items. */
    parseBoq: a
      .mutation()
      .arguments({
        s3Bucket: a.string().required(),
        s3Key: a.string().required(),
        boqUploadId: a.id(),
      })
      .returns(
        a.customType({
          totalLines: a.integer().required(),
          matched: a.integer().required(),
          unmatched: a.integer().required(),
          hsnWarnings: a.integer().required(),
          lineItems: a.json(),
        }),
      )
      .handler(a.handler.function(boqParser))
      .authorization((allow) => [allow.groups(["Admin", "Purchase"])]),

    /** CRUD hook for personal reminders — creates/deletes EventBridge schedules. */
    syncReminderSchedule: a
      .mutation()
      .arguments({
        reminderId: a.id().required(),
        op: a.string().required(), // "UPSERT" | "DELETE"
      })
      .returns(
        a.customType({
          action: a.string().required(),
        }),
      )
      .handler(a.handler.function(reminderDispatcher))
      .authorization((allow) => [allow.authenticated()]),

    /**
     * Client portal — read-only project view, authenticated via a per-project
     * ClientPortalToken. Uses API_KEY auth so no Cognito login is required.
     * The handler enforces token + expiry + project-scope checks internally.
     */
    getClientPortal: a
      .query()
      .arguments({
        token: a.string().required(),
        projectId: a.id().required(),
      })
      .returns(
        a.customType({
          projectName: a.string(),
          companyName: a.string(),
          clientName: a.string(),
          siteCity: a.string(),
          siteState: a.string(),
          startDate: a.date(),
          expectedEndDate: a.date(),
          status: a.string(),
          unitCount: a.integer(),
          units: a.json(),
          tokenExpiresAt: a.datetime(),
          generatedAt: a.datetime(),
          error: a.string(),
        }),
      )
      .handler(a.handler.function(clientPortalHandler))
      .authorization((allow) => [allow.publicApiKey()]),

    /** Cognito user pool administration — Admin only. */
    manageUser: a
      .mutation()
      .arguments({
        op: a.string().required(), // LIST | CREATE | ADD_GROUP | REMOVE_GROUP | RESET_PASSWORD | DISABLE | ENABLE | DELETE
        email: a.string(),
        givenName: a.string(),
        familyName: a.string(),
        role: a.string(),
        username: a.string(),
        limit: a.integer(),
      })
      .returns(
        a.customType({
          users: a.json(),
          affected: a.string(),
          error: a.string(),
        }),
      )
      .handler(a.handler.function(userAdmin))
      .authorization((allow) => [allow.group("Admin")]),
  })
  /**
   * Default auth: any authenticated Cognito user can read (specific fields
   * are further restricted at the model level). Lambda IAM auth is granted
   * per-function via `defineData({ authorizationModes.lambdaAuthorizationMode })`
   * and via IAM policies on the individual Lambda execution roles.
   */
  .authorization((allow) => [
    allow.authenticated(),
    // Let the listed Lambdas read/write any model they need to operate on.
    // This is required because they issue AppSync calls with their IAM role.
    allow.resource(hsnValidator),
    allow.resource(forexRateFetcher),
    allow.resource(chatbotHandler),
    allow.resource(tallyExportGenerator),
    allow.resource(invoiceScheduler),
    allow.resource(invoiceConfirmationScheduler),
    allow.resource(boqParser),
    allow.resource(reminderDispatcher),
    allow.resource(userAdmin),
    allow.resource(clientPortalHandler),
  ]);

export type Schema = ClientSchema<typeof schema>;

export const data = defineData({
  schema,
  authorizationModes: {
    defaultAuthorizationMode: "userPool",
    apiKeyAuthorizationMode: {
      expiresInDays: 30, // client portal fallback; rotated by the FY rollover Lambda
    },
  },
});
