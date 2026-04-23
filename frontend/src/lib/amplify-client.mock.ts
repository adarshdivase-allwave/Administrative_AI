/**
 * E2E mock adapter for the Amplify client.
 *
 * Activated at build time when `VITE_E2E_MOCK=1`. The real `amplify-client.ts`
 * detects the flag and re-exports this module's `api` + `Schema` types,
 * transparently swapping every `api.models.*` / `api.queries.*` /
 * `api.mutations.*` call for an in-memory deterministic backend.
 *
 * The mock backend is:
 *   - In-memory only (wiped on reload)
 *   - Seeded with 1 company, 2 clients, 2 vendors, 1 godown, 3 products,
 *     8 UnitRecords, 1 active invoice
 *   - Honors CRUD operations with autoincrement IDs
 *   - Simulates the AppSync custom mutations (HSN, forex, Tally) with
 *     realistic-but-fake return values
 *
 * Keeping this in sync with the real schema is the ONE maintenance cost.
 * Every time a model field is added to `amplify/data/resource.ts`, if it
 * affects a mocked flow, update the corresponding seed row below.
 */

interface Row extends Record<string, unknown> {
  id: string;
  createdAt?: string;
  updatedAt?: string;
}

const store: Record<string, Row[]> = {};

function seed() {
  const now = new Date().toISOString();
  store.SystemSettings = [
    {
      id: "GLOBAL",
      companyName: "Mock AV Co",
      companyGstin: "27AAPFU0939F1ZV",
      msmeEnabled: true,
      msmeUdyamRegistrationNumber: "UDYAM-MH-25-0000001",
      eWayBillThresholdInr: 50000,
      poApprovalThresholdInr: 50000,
      createdAt: now,
      updatedAt: now,
    },
  ];
  store.Vendor = [
    { id: "v1", name: "LG India", gstin: "27AAACL1234A1Z5", isActive: true, paymentTermsDays: 30, createdAt: now, updatedAt: now },
    { id: "v2", name: "JBL Pro", gstin: "29AAACJ5678B1Z3", isActive: true, paymentTermsDays: 30, createdAt: now, updatedAt: now },
  ];
  store.Client = [
    { id: "c1", name: "Test Client A", gstin: "27AAAAA0000A1Z2", billingEmail: "ap@test.co", paymentTermsDays: 30, isActive: true, createdAt: now, updatedAt: now },
    { id: "c2", name: "Test Client B", gstin: "29AAACO0148F1ZP", billingEmail: "ap2@test.co", paymentTermsDays: 45, isActive: true, createdAt: now, updatedAt: now },
  ];
  store.Godown = [
    { id: "g1", name: "Mumbai Godown", city: "Mumbai", state: "Maharashtra", createdAt: now, updatedAt: now },
  ];
  store.ProductMaster = [
    { id: "p1", productName: "LG 55UR640S", brand: "LG", modelNumber: "55UR640S", category: "Display", hsnCode: "85287200", hsnTallyFormat: "85287200", hsnTallyCompatible: true, gstRatePercent: 18, sellingPrice: 65000, lowStockThreshold: 5, importRequired: false, warrantyPeriodMonths: 12, amcEligible: true, createdAt: now, updatedAt: now },
    { id: "p2", productName: "JBL IRX112BT", brand: "JBL", modelNumber: "IRX112BT", category: "Audio", hsnCode: "85182200", hsnTallyFormat: "85182200", hsnTallyCompatible: true, gstRatePercent: 18, sellingPrice: 42000, lowStockThreshold: 4, importRequired: false, warrantyPeriodMonths: 12, amcEligible: true, createdAt: now, updatedAt: now },
    { id: "p3", productName: "HDMI Cable 5m", brand: "Kramer", hsnCode: "85444299", hsnTallyFormat: "85444299", hsnTallyCompatible: true, gstRatePercent: 18, sellingPrice: 1200, lowStockThreshold: 20, importRequired: false, warrantyPeriodMonths: 12, amcEligible: false, createdAt: now, updatedAt: now },
  ];
  store.UnitRecord = Array.from({ length: 8 }, (_, i) => ({
    id: `u${i + 1}`,
    productId: i < 3 ? "p1" : i < 5 ? "p2" : "p3",
    serialNumber: `SN-MOCK-${String(i + 1).padStart(5, "0")}`,
    inventoryCategory: "GENERAL_STOCK",
    status: "IN_STOCK",
    condition: "NEW",
    godownId: "g1",
    godownLocation: `A${(i % 3) + 1}-S${(i % 4) + 1}`,
    purchasePrice: i < 3 ? 45000 : i < 5 ? 30000 : 800,
    purchaseCurrency: "INR",
    hsnCode: i < 3 ? "85287200" : i < 5 ? "85182200" : "85444299",
    hsnTallyFormat: i < 3 ? "85287200" : i < 5 ? "85182200" : "85444299",
    hsnValidationStatus: "VALID",
    warrantyExpiryDate: "2026-04-15",
    vendorId: i < 3 ? "v1" : "v2",
    createdAt: now,
    updatedAt: now,
  }));
  store.ClientInvoice = [
    { id: "inv1", invoiceNumber: "INV-2526-00001", invoiceDate: now.slice(0, 10), dueDate: new Date(Date.now() + 30 * 86400_000).toISOString().slice(0, 10), clientId: "c1", amountDueInr: 100000, totalAmountInr: 118000, cgstInr: 9000, sgstInr: 9000, igstInr: 0, status: "SENT", paymentTermsDays: 30, createdAt: now, updatedAt: now },
  ];
  store.StockAlert = [];
  store.AuditLog = [];
  store.Bill = [];
  store.Project = [];
  store.PurchaseOrder = [];
  store.DeliveryChallan = [];
  store.GoodsReceivedNote = [];
  store.DispatchLineItem = [];
  store.MSMEComplianceLog = [];
  store.ServiceTicket = [];
  store.AMCContract = [];
  store.TransferOrder = [];
  store.BOQUpload = [];
  store.HSNDatabase = [];
  store.ForexRateCache = [];
  store.FYSequenceCounter = [];
  store.ReminderLog = [];
  store.Reminder = [];
  store.Comment = [];
  store.ActivityFeed = [];
  store.ChatSession = [];
  store.ClientPortalToken = [];
  store.DepreciationRecord = [];
  store.BillReminderLog = [];
  store.PaymentReminderLog = [];
  store.InvoiceConfirmation = [];
  store.DemoRecord = [];
  store.ReturnRecord = [];
  store.POLineItem = [];
}
seed();

function nextId(): string {
  return `mock-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

function model(name: string) {
  return {
    list: async (args: { filter?: Record<string, { eq?: unknown }>; limit?: number } = {}) => {
      const all = store[name] ?? [];
      const filtered = args.filter
        ? all.filter((row) => {
            for (const [k, cond] of Object.entries(args.filter ?? {})) {
              if (cond?.eq != null && row[k] !== cond.eq) return false;
            }
            return true;
          })
        : all;
      return { data: filtered.slice(0, args.limit ?? 500) };
    },
    get: async ({ id }: { id: string }) => {
      const row = (store[name] ?? []).find((r) => r.id === id);
      return { data: row ?? null };
    },
    create: async (input: Record<string, unknown>) => {
      const now = new Date().toISOString();
      const row: Row = { id: (input.id as string) ?? nextId(), createdAt: now, updatedAt: now, ...input };
      store[name] = [...(store[name] ?? []), row];
      return { data: row };
    },
    update: async (input: Record<string, unknown>) => {
      const id = input.id as string;
      const now = new Date().toISOString();
      let updated: Row | null = null;
      store[name] = (store[name] ?? []).map((r) => {
        if (r.id === id) {
          updated = { ...r, ...input, updatedAt: now };
          return updated;
        }
        return r;
      });
      return { data: updated };
    },
    delete: async ({ id }: { id: string }) => {
      store[name] = (store[name] ?? []).filter((r) => r.id !== id);
      return { data: { id } };
    },
    observeQuery: (args?: { filter?: Record<string, { eq?: unknown }> }) => {
      // Fire once with current items; don't bother with a real subscription.
      return {
        subscribe: (handlers: { next: (d: { items: Row[] }) => void }) => {
          const all = store[name] ?? [];
          const items = args?.filter
            ? all.filter((row) =>
                Object.entries(args.filter ?? {}).every(
                  ([k, cond]) => cond?.eq == null || row[k] === cond.eq,
                ),
              )
            : all;
          handlers.next({ items });
          return { unsubscribe: () => undefined };
        },
      };
    },
  };
}

// Proxy for api.models so every model name auto-generates a handler.
const models = new Proxy(
  {},
  {
    get: (_t, prop: string) => model(prop),
  },
);

// Mock mutations / queries for the Lambda-backed operations.
const mutations = {
  validateHsn: async (input: { hsnCode?: string; productName?: string }) => {
    if (input.hsnCode === "85287200") {
      return {
        data: {
          status: "VALID",
          hsnCode: "85287200",
          description: "Television reception apparatus (LCD / signage displays)",
          gstRatePercent: 18,
          tallyFormat: "85287200",
          tallyCompatible: true,
          isSac: false,
        },
      };
    }
    if (input.productName) {
      return {
        data: {
          status: "AI_SUGGESTED",
          hsnCode: "85287200",
          description: "AI-suggested based on product name",
          gstRatePercent: 18,
          tallyFormat: "85287200",
          tallyCompatible: true,
          isSac: false,
          sourceUrl: "https://cbic.gov.in/mock",
          sourceDomain: "cbic.gov.in",
        },
      };
    }
    return {
      data: {
        status: "INVALID",
        hsnCode: input.hsnCode ?? "",
        description: "",
        gstRatePercent: 0,
        tallyFormat: "",
        tallyCompatible: false,
        isSac: false,
        error: "Not found in mock database",
      },
    };
  },
  generateTallyExport: async (input: { kind: string; grnId?: string; dcId?: string }) => {
    return {
      data: {
        s3Key: `tally-exports/${input.kind.toLowerCase()}/mock-${Date.now()}.xml`,
        presignedUrl: "https://example.com/mock-tally.xml",
        xmlSize: 1234,
        voucherCount: 1,
        exportedAt: new Date().toISOString(),
      },
    };
  },
  scheduleInvoiceReminders: async (_input: { action: string; invoiceId: string }) => {
    return {
      data: {
        scheduled: 8,
        deleted: 0,
        stages: ["T_MINUS_15", "T_MINUS_7", "T_ZERO", "T_PLUS_1", "T_PLUS_7", "T_PLUS_14", "T_PLUS_30", "T_PLUS_45"],
      },
    };
  },
  chatbotMessage: async (input: { message: string; userId: string }) => {
    return {
      data: {
        sessionId: "mock-session",
        reply: `Mock response to: "${input.message}"`,
        sourceCitations: [],
        rateLimited: false,
      },
    };
  },
  parseBoq: async () => ({
    data: { totalLines: 3, matched: 2, unmatched: 1, hsnWarnings: 0, lineItems: [] },
  }),
  manageUser: async (input: { op: string; email?: string }) => {
    if (input.op === "LIST") {
      return {
        data: {
          users: [
            { username: "admin@mock.co", email: "admin@mock.co", enabled: true, status: "CONFIRMED", groups: ["Admin"] },
            { username: "sales@mock.co", email: "sales@mock.co", enabled: true, status: "CONFIRMED", groups: ["Sales"] },
          ],
        },
      };
    }
    return { data: { affected: input.email ?? "mock" } };
  },
  manageInvoiceConfirmation: async () => ({ data: { action: "ok" } }),
  syncReminderSchedule: async () => ({ data: { action: "ok" } }),
};

const queries = {
  forexRate: async (input: { quoteCurrency: string }) => {
    return {
      data: {
        baseCurrency: "INR",
        quoteCurrency: input.quoteCurrency,
        rate: input.quoteCurrency === "USD" ? 83.42 : input.quoteCurrency === "EUR" ? 90.12 : 105.33,
        fetchedAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 6 * 3600_000).toISOString(),
        cacheHit: false,
        source: "mock",
      },
    };
  },
  getClientPortal: async (input: { token: string; projectId: string }) => {
    if (input.token !== "valid-mock-token") {
      return { data: { error: "Invalid or unknown access link." } };
    }
    return {
      data: {
        projectName: "Mock Project",
        companyName: "Mock AV Co",
        clientName: "Test Client A",
        siteCity: "Mumbai",
        siteState: "Maharashtra",
        status: "IN_PROGRESS",
        unitCount: 3,
        units: [
          { serialNumber: "SN-MOCK-00001", productName: "LG 55UR640S", status: "ALLOCATED_TO_PROJECT" },
          { serialNumber: "SN-MOCK-00002", productName: "LG 55UR640S", status: "ALLOCATED_TO_PROJECT" },
          { serialNumber: "SN-MOCK-00003", productName: "LG 55UR640S", status: "ALLOCATED_TO_PROJECT" },
        ],
        tokenExpiresAt: new Date(Date.now() + 30 * 86400_000).toISOString(),
        generatedAt: new Date().toISOString(),
      },
    };
  },
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const api: any = { models, mutations, queries };

// Export type so the same consumers keep their types.
export type Schema = Record<string, unknown>;
