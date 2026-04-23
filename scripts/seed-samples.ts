#!/usr/bin/env tsx
/**
 * seed-samples — populates a dev / staging environment with a realistic
 * baseline data set so the UI can be exercised without laborious manual entry.
 *
 * NEVER run against production. Refuses to run when APP_ENV === "prod".
 *
 * What gets created:
 *   - 1 SystemSettings row (company identity, MSME, Tally ledger map)
 *   - 3 Godowns (Mumbai, Bangalore, Delhi)
 *   - 5 Vendors (AV brands)
 *   - 3 Clients (enterprise, SMB, govt)
 *   - 2 Projects
 *   - 10 ProductMasters across categories
 *   - ~50 UnitRecords distributed across GENERAL_STOCK / PROJECT / DEMO
 *   - 1 TDS Bill pre-created for current month
 *
 * Idempotent via deterministic UUIDs (same run → same IDs, no duplicates).
 */
import { randomUUID } from "node:crypto";
import { putItem } from "../amplify/functions/_lib/ddb.js";
import { fyShort, fyLabel } from "../shared/fy.js";

const appEnv = process.env.APP_ENV ?? "dev";
if (appEnv === "prod") {
  console.error("Refusing to seed samples into production. Set APP_ENV to dev/staging.");
  process.exit(1);
}

// Deterministic IDs so a re-run overwrites the same rows.
const D = (prefix: string, n: number) => `${prefix}-sample-${String(n).padStart(3, "0")}`;

async function main(): Promise<void> {
  console.log(`Seeding sample data into APP_ENV=${appEnv}...`);

  const now = new Date().toISOString();

  // ---- SystemSettings ----
  await putItem("SystemSettings", {
    id: "GLOBAL",
    companyName: "Acme AV Integrations Pvt Ltd",
    companyGstin: "27AAPFU0939F1ZV",
    companyStateCode: "27",
    companyAddressLine1: "Plot 42, Andheri East",
    companyCity: "Mumbai",
    companyState: "Maharashtra",
    companyPincode: "400069",
    companyOpsEmail: "ops@acme-av.example.com",
    invoicePrefix: "INV",
    dcPrefix: "DC",
    grnPrefix: "GRN",
    poPrefix: "PO",
    eWayBillThresholdInr: 50000,
    poApprovalThresholdInr: 50000,
    cognitoIdleSessionTtlSeconds: 1800,
    msmeEnabled: true,
    msmeUdyamRegistrationNumber: "UDYAM-MH-25-1234567",
    msmeCertificateS3Key: "msme/certificate.pdf",
    msmeEnterpriseClassification: "MICRO",
    msmeRequireAdminApproval: false,
    msmeAutoTriggerDays: 45,
    tallyPurchaseLedgerName: "Purchase Accounts",
    tallySalesLedgerName: "Sales Accounts",
    tallyCgstLedgerName: "CGST 9%",
    tallySgstLedgerName: "SGST 9%",
    tallyIgstLedgerName: "IGST 18%",
    tallyVendorNameMap: {},
    tallyClientNameMap: {},
    chatbotRateLimitPerMin: 10,
    sesFromEmail: "no-reply@inventory.acme-av.example.com",
    sesReplyTo: "ops@acme-av.example.com",
    dcPriceSource: "SELLING_PRICE",
    createdAt: now,
    updatedAt: now,
  });
  console.log("  ✓ SystemSettings");

  // ---- Godowns ----
  const godowns = [
    { city: "Mumbai", state: "Maharashtra", pin: "400069", manager: "Priya Shah" },
    { city: "Bangalore", state: "Karnataka", pin: "560001", manager: "Rohit Iyer" },
    { city: "New Delhi", state: "Delhi", pin: "110001", manager: "Amit Verma" },
  ];
  for (let i = 0; i < godowns.length; i++) {
    const g = godowns[i]!;
    await putItem("Godown", {
      id: D("gw", i + 1),
      name: `${g.city} Godown`,
      city: g.city,
      state: g.state,
      pincode: g.pin,
      manager: g.manager,
      phone: "+91-98200-00000",
      createdAt: now,
      updatedAt: now,
    });
  }
  console.log(`  ✓ ${godowns.length} Godowns`);

  // ---- Vendors ----
  const vendors = [
    { name: "LG Electronics India", gstin: "27AAACL1234A1Z5", city: "Mumbai", tally: "LG Electronics" },
    { name: "Harman Professional", gstin: "29AAACH5678B1Z3", city: "Bangalore", tally: "Harman Professional" },
    { name: "Crestron India", gstin: "07AAACR9012C1Z7", city: "New Delhi", tally: "Crestron India" },
    { name: "Samsung India", gstin: "27AAACS3456D1Z1", city: "Mumbai", tally: "Samsung India" },
    { name: "Logitech India", gstin: "29AAACL7890E1Z9", city: "Bangalore", tally: "Logitech India" },
  ];
  const vendorIds: string[] = [];
  for (let i = 0; i < vendors.length; i++) {
    const v = vendors[i]!;
    const id = D("v", i + 1);
    vendorIds.push(id);
    await putItem("Vendor", {
      id,
      name: v.name,
      gstin: v.gstin,
      stateCode: v.gstin.slice(0, 2),
      city: v.city,
      state: v.city === "Mumbai" ? "Maharashtra" : v.city === "Bangalore" ? "Karnataka" : "Delhi",
      contactEmail: `contact@${v.name.toLowerCase().replace(/\s+/g, "")}.example.com`,
      contactPhone: "+91-99xxxxxxxxx",
      tallyLedgerName: v.tally,
      paymentTermsDays: 30,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
  }
  console.log(`  ✓ ${vendors.length} Vendors`);

  // ---- Clients ----
  const clients = [
    { name: "Tata Consultancy Services", gstin: "27AAACT1234X1Z5", city: "Mumbai", state: "Maharashtra" },
    { name: "Reliance Jio Infocomm", gstin: "27AAACR5678Y1Z3", city: "Mumbai", state: "Maharashtra" },
    { name: "Ministry of Electronics", gstin: "07AAAGM9012Z1Z7", city: "New Delhi", state: "Delhi" },
  ];
  const clientIds: string[] = [];
  for (let i = 0; i < clients.length; i++) {
    const c = clients[i]!;
    const id = D("c", i + 1);
    clientIds.push(id);
    await putItem("Client", {
      id,
      name: c.name,
      gstin: c.gstin,
      stateCode: c.gstin.slice(0, 2),
      billingCity: c.city,
      billingState: c.state,
      billingEmail: `ap@${c.name.split(" ")[0]!.toLowerCase()}.example.com`,
      contactEmail: `pm@${c.name.split(" ")[0]!.toLowerCase()}.example.com`,
      tallyLedgerName: c.name,
      paymentTermsDays: 30,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
  }
  console.log(`  ✓ ${clients.length} Clients`);

  // ---- Projects ----
  const projects = [
    {
      name: "TCS BKC Boardroom Refresh",
      clientIdx: 0,
      start: "2025-05-01",
      end: "2025-07-31",
    },
    { name: "Jio World Centre Auditorium", clientIdx: 1, start: "2025-06-15", end: "2025-09-30" },
  ];
  const projectIds: string[] = [];
  for (let i = 0; i < projects.length; i++) {
    const p = projects[i]!;
    const id = D("pj", i + 1);
    projectIds.push(id);
    await putItem("Project", {
      id,
      projectName: p.name,
      clientId: clientIds[p.clientIdx]!,
      projectCode: `${p.name.split(" ").map((w) => w[0]).join("")}-${i + 1}`,
      startDate: p.start,
      expectedEndDate: p.end,
      status: "IN_PROGRESS",
      createdAt: now,
      updatedAt: now,
    });
  }
  console.log(`  ✓ ${projects.length} Projects`);

  // ---- ProductMaster ----
  const products = [
    { name: "LG 55UR640S Signage Display", brand: "LG", model: "55UR640S", cat: "Display", hsn: "85287200", gst: 18, price: 65000, threshold: 5 },
    { name: "LG 65UR640S Signage Display", brand: "LG", model: "65UR640S", cat: "Display", hsn: "85287200", gst: 18, price: 95000, threshold: 3 },
    { name: "JBL IRX112BT Speaker", brand: "JBL", model: "IRX112BT", cat: "Audio", hsn: "85182200", gst: 18, price: 42000, threshold: 4 },
    { name: "Shure MXA910 Ceiling Mic", brand: "Shure", model: "MXA910", cat: "Audio", hsn: "85365020", gst: 18, price: 180000, threshold: 2 },
    { name: "Crestron NVX Encoder", brand: "Crestron", model: "DM-NVX-E30", cat: "Switcher", hsn: "85437099", gst: 18, price: 120000, threshold: 3 },
    { name: "Poly Studio X70 Camera", brand: "Poly", model: "X70", cat: "Conferencing", hsn: "85258090", gst: 18, price: 280000, threshold: 2, imported: true },
    { name: "Logitech Rally Bar Mini", brand: "Logitech", model: "Rally Bar Mini", cat: "Conferencing", hsn: "85258090", gst: 18, price: 195000, threshold: 3 },
    { name: "HDMI 2.0 Cable 5m", brand: "Kramer", model: "C-HM/HM/Pro", cat: "Cabling", hsn: "85444299", gst: 18, price: 1200, threshold: 20 },
    { name: "Cat6A Shielded Cable 305m box", brand: "Commscope", model: "Uniprise", cat: "Cabling", hsn: "85447090", gst: 18, price: 18000, threshold: 3 },
    { name: "Cisco Catalyst 9200L Switch", brand: "Cisco", model: "9200L", cat: "Networking", hsn: "85176200", gst: 18, price: 145000, threshold: 2, imported: true },
  ];
  const productIds: string[] = [];
  for (let i = 0; i < products.length; i++) {
    const p = products[i]!;
    const id = D("p", i + 1);
    productIds.push(id);
    await putItem("ProductMaster", {
      id,
      productName: p.name,
      brand: p.brand,
      modelNumber: p.model,
      category: p.cat,
      hsnCode: p.hsn,
      hsnTallyFormat: p.hsn,
      hsnTallyCompatible: true,
      hsnCodeSource: "MANUAL",
      gstRatePercent: p.gst,
      sellingPrice: p.price,
      sellingPriceExGST: Math.round(p.price / (1 + p.gst / 100)),
      lowStockThreshold: p.threshold,
      reorderQuantity: p.threshold * 2,
      importRequired: Boolean(p.imported),
      importLeadTimeDays: p.imported ? 60 : undefined,
      countryOfOrigin: p.imported ? "USA" : "India",
      customsDutyPercent: p.imported ? 10 : 0,
      warrantyPeriodMonths: 12,
      amcEligible: true,
      unitOfMeasure: "Nos",
      preferredVendorId: vendorIds[i % vendorIds.length],
      createdAt: now,
      updatedAt: now,
    });
  }
  console.log(`  ✓ ${products.length} ProductMasters`);

  // ---- UnitRecords (~50 distributed) ----
  let unitCount = 0;
  for (let pi = 0; pi < productIds.length; pi++) {
    const productId = productIds[pi]!;
    const product = products[pi]!;
    const stockCount = Math.max(1, product.threshold - (pi % 3)); // varies: some below threshold
    for (let u = 0; u < stockCount; u++) {
      unitCount++;
      const id = D("u", unitCount);
      const sn = `SN-${product.brand.slice(0, 3).toUpperCase()}-${String(unitCount).padStart(5, "0")}`;
      const godownIdx = unitCount % 3;
      await putItem("UnitRecord", {
        id,
        productId,
        serialNumber: sn,
        qrCodeLabel: `https://inventory.acme-av.example.com/unit/${id}`,
        inventoryCategory: unitCount % 7 === 0 ? "PROJECT" : unitCount % 11 === 0 ? "DEMO" : "GENERAL_STOCK",
        status:
          unitCount % 7 === 0
            ? "ALLOCATED_TO_PROJECT"
            : unitCount % 11 === 0
              ? "ON_DEMO"
              : "IN_STOCK",
        condition: "NEW",
        godownId: D("gw", godownIdx + 1),
        godownLocation: `A${godownIdx + 1}-S${(unitCount % 4) + 1}`,
        purchasePrice: Math.round(product.price * 0.7), // approx cost
        purchaseCurrency: "INR",
        purchaseDate: "2025-04-15",
        vendorId: vendorIds[pi % vendorIds.length],
        hsnCode: product.hsn,
        hsnTallyFormat: product.hsn,
        hsnValidationStatus: "VALID",
        warrantyExpiryDate: "2026-04-15",
        currentProjectId: unitCount % 7 === 0 ? projectIds[0] : undefined,
        createdAt: now,
        updatedAt: now,
      });
    }
  }
  console.log(`  ✓ ${unitCount} UnitRecords`);

  // ---- FY counters (initial) ----
  const fy = fyShort(new Date());
  for (const kind of ["INVOICE", "DC", "GRN", "PO"] as const) {
    const prefix = { INVOICE: "INV", DC: "DC", GRN: "GRN", PO: "PO" }[kind];
    const key = `${kind}#${prefix}#${fy}`;
    await putItem("FYSequenceCounter", {
      id: key,
      counterKey: key,
      fyYear: fy,
      prefix,
      documentKind: kind,
      lastSequence: 0,
      createdAt: now,
      updatedAt: now,
    });
  }
  console.log(`  ✓ 4 FYSequenceCounter rows for ${fy}`);

  // ---- One TDS Bill due this month ----
  const thisMonth = new Date();
  await putItem("Bill", {
    id: `TDS-${thisMonth.getFullYear()}-${String(thisMonth.getMonth() + 1).padStart(2, "0")}`,
    billType: "TDS",
    description: `TDS deposit for ${thisMonth.toLocaleString("en-IN", { month: "long", year: "numeric" })}`,
    vendorOrAuthority: "Income Tax Department (TDS/TCS)",
    billingCycle: "MONTHLY",
    dueDate: new Date(thisMonth.getFullYear(), thisMonth.getMonth(), 7).toISOString(),
    recurringDayOfMonth: 7,
    reminderDaysBefore: 3,
    status: "PENDING",
    fyYear: fyLabel(thisMonth).replace(/^FY /, ""),
    createdAt: now,
    updatedAt: now,
  });
  console.log("  ✓ 1 TDS Bill");

  console.log(`\n✓ Sample data seeded into APP_ENV=${appEnv}`);
  console.log(`  Created: 1 settings + 3 godowns + ${vendors.length} vendors + ${clients.length} clients + ${projects.length} projects + ${products.length} products + ${unitCount} units + 4 counters + 1 bill`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
