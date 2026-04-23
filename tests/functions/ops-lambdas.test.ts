import { describe, it, beforeEach, expect } from "../helpers/test-shim.js";
import { mockClient } from "aws-sdk-client-mock";
import {
  DynamoDBDocumentClient,
  ScanCommand,
  GetCommand,
  PutCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import { SESv2Client, SendEmailCommand } from "@aws-sdk/client-sesv2";
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import {
  SchedulerClient,
  CreateScheduleCommand,
  DeleteScheduleCommand,
  ListSchedulesCommand,
} from "@aws-sdk/client-scheduler";
import { _resetClientsForTests } from "../../amplify/functions/_lib/aws-clients.js";
import type { EventBridgeEvent } from "aws-lambda";
import * as XLSX from "xlsx";

const ddb = mockClient(DynamoDBDocumentClient);
const ses = mockClient(SESv2Client);
const s3 = mockClient(S3Client);
const sch = mockClient(SchedulerClient);

function evt(time: string): EventBridgeEvent<"Scheduled Event", unknown> {
  return {
    version: "0",
    id: "x",
    "detail-type": "Scheduled Event",
    source: "aws.events",
    account: "123",
    time,
    region: "ap-south-1",
    resources: [],
    detail: {},
  };
}

beforeEach(() => {
  ddb.reset();
  ses.reset();
  s3.reset();
  sch.reset();
  _resetClientsForTests();
  process.env.SES_FROM_EMAIL = "noreply@example.com";
  process.env.REMINDER_DISPATCHER_ARN = "arn:x";
  process.env.SCHEDULER_INVOKE_ROLE_ARN = "arn:y";
  process.env.APP_ENV = "test";
  delete process.env.OPENSEARCH_COLLECTION_ENDPOINT;
});

// -------------------- alert-engine --------------------
describe("alert-engine", () => {
  it("creates OUT_OF_STOCK alert when product has zero units in stock", async () => {
    const { handler } = await import("../../amplify/functions/alert-engine/handler.js");
    ddb.on(ScanCommand).callsFake((input) => {
      const tbl = (input as { TableName?: string }).TableName ?? "";
      if (tbl.startsWith("ProductMaster")) {
        return {
          Items: [
            {
              id: "p1",
              productName: "LG Display",
              lowStockThreshold: 5,
            },
          ],
        };
      }
      // Everything else returns empty (no units, no demos, no transits, no AMCs, no POs)
      return { Items: [] };
    });
    ddb.on(GetCommand).resolves({}); // no existing alerts
    ddb.on(PutCommand).resolves({});

    await handler(evt("2025-07-15T03:30:00Z"), {} as never, () => {});

    const puts = ddb.commandCalls(PutCommand);
    const alertPut = puts.find((p) => {
      const item = p.args[0].input.Item as Record<string, unknown>;
      return item?.alertType === "OUT_OF_STOCK";
    });
    expect(alertPut).toBeTruthy();
  });

  it("creates LOW_STOCK alert when count <= threshold", async () => {
    const { handler } = await import("../../amplify/functions/alert-engine/handler.js");
    ddb.on(ScanCommand).callsFake((input) => {
      const tbl = (input as { TableName?: string }).TableName ?? "";
      if (tbl.startsWith("ProductMaster")) {
        return {
          Items: [{ id: "p1", productName: "HDMI Cable", lowStockThreshold: 10 }],
        };
      }
      if (tbl.startsWith("UnitRecord")) {
        return { Items: [{ id: "u1", productId: "p1" }, { id: "u2", productId: "p1" }] };
      }
      return { Items: [] };
    });
    ddb.on(GetCommand).resolves({});
    ddb.on(PutCommand).resolves({});

    await handler(evt("2025-07-15T03:30:00Z"), {} as never, () => {});

    const puts = ddb.commandCalls(PutCommand);
    const low = puts.find((p) => {
      const item = p.args[0].input.Item as Record<string, unknown>;
      return item?.alertType === "LOW_STOCK";
    });
    expect(low).toBeTruthy();
  });
});

// -------------------- daily-digest --------------------
describe("daily-digest", () => {
  it("sends one email per role with recipients configured", async () => {
    const { handler } = await import("../../amplify/functions/daily-digest/handler.js");
    process.env.DIGEST_ADMIN_EMAILS = "admin@example.com";
    process.env.DIGEST_SALES_EMAILS = "sales@example.com";
    delete process.env.DIGEST_LOGISTICS_EMAILS;
    delete process.env.DIGEST_PURCHASE_EMAILS;

    ddb.on(ScanCommand).resolves({ Items: [] });
    ddb.on(PutCommand).resolves({});
    ses.on(SendEmailCommand).resolves({ MessageId: "m" });

    await handler(evt("2025-07-15T02:30:00Z"), {} as never, () => {});

    // 2 recipients → 2 SES sends
    expect(ses.commandCalls(SendEmailCommand).length).toBe(2);
  });

  it("silently skips roles with no recipients", async () => {
    const { handler } = await import("../../amplify/functions/daily-digest/handler.js");
    for (const k of ["ADMIN", "LOGISTICS", "PURCHASE", "SALES"]) {
      delete process.env[`DIGEST_${k}_EMAILS`];
    }

    ddb.on(ScanCommand).resolves({ Items: [] });
    ddb.on(PutCommand).resolves({});

    await handler(evt("2025-07-15T02:30:00Z"), {} as never, () => {});
    expect(ses.commandCalls(SendEmailCommand).length).toBe(0);
  });
});

// -------------------- warranty-alert-monthly --------------------
describe("warranty-alert-monthly", () => {
  it("skips silently when no warranty is within 90 days", async () => {
    const { handler } = await import(
      "../../amplify/functions/warranty-alert-monthly/handler.js"
    );
    ddb.on(ScanCommand).resolves({
      Items: [
        {
          id: "u1",
          warrantyExpiryDate: new Date(Date.now() + 365 * 86400_000)
            .toISOString()
            .slice(0, 10),
        },
      ],
    });

    await handler(evt("2025-07-01T01:30:00Z"), {} as never, () => {});
    expect(ses.commandCalls(SendEmailCommand).length).toBe(0);
  });
});

// -------------------- amc-renewal-checker --------------------
describe("amc-renewal-checker", () => {
  it("emits AMC_EXPIRING_45 alert for a contract 30 days out", async () => {
    const { handler } = await import(
      "../../amplify/functions/amc-renewal-checker/handler.js"
    );
    process.env.DIGEST_ADMIN_EMAILS = "admin@example.com";
    ddb.on(ScanCommand).resolves({
      Items: [
        {
          id: "a1",
          contractNumber: "AMC-1",
          status: "ACTIVE",
          endDate: new Date(Date.now() + 30 * 86400_000).toISOString().slice(0, 10),
        },
      ],
    });
    ddb.on(PutCommand).resolves({});
    ddb.on(UpdateCommand).resolves({});
    ses.on(SendEmailCommand).resolves({ MessageId: "m" });

    await handler(evt("2025-07-01T05:00:00Z"), {} as never, () => {});

    const alertPut = ddb.commandCalls(PutCommand).find((c) => {
      const item = c.args[0].input.Item as Record<string, unknown>;
      return item?.alertType === "AMC_EXPIRING_45";
    });
    expect(alertPut).toBeTruthy();
  });
});

// -------------------- reminder-dispatcher --------------------
describe("reminder-dispatcher", () => {
  it("SYNC_SCHEDULES + UPSERT creates an EventBridge schedule", async () => {
    const { handler } = await import(
      "../../amplify/functions/reminder-dispatcher/handler.js"
    );
    ddb.on(GetCommand).resolves({
      Item: {
        id: "r1",
        userId: "u1",
        title: "Call vendor",
        remindAt: new Date(Date.now() + 3600_000).toISOString(),
        status: "ACTIVE",
      },
    });
    sch.on(CreateScheduleCommand).resolves({ ScheduleArn: "x" });
    sch.on(DeleteScheduleCommand).resolves({});

    const out = await handler({ mode: "SYNC_SCHEDULES", reminderId: "r1", op: "UPSERT" });
    expect(out.action).toBe("scheduled");
    expect(sch.commandCalls(CreateScheduleCommand).length).toBe(1);
  });

  it("FIRE marks a one-shot reminder COMPLETED", async () => {
    const { handler } = await import(
      "../../amplify/functions/reminder-dispatcher/handler.js"
    );
    ddb.on(GetCommand).callsFake((input) => {
      const tbl = (input as { TableName?: string }).TableName ?? "";
      if (tbl.startsWith("Reminder")) {
        return {
          Item: {
            id: "r1",
            userId: "u1",
            title: "Test",
            remindAt: new Date().toISOString(),
            status: "ACTIVE",
            recurring: false,
          },
        };
      }
      if (tbl.startsWith("User")) {
        return { Item: { id: "u1", email: "user@example.com", givenName: "Rahul" } };
      }
      return {};
    });
    ddb.on(PutCommand).resolves({});
    ddb.on(UpdateCommand).resolves({});
    ses.on(SendEmailCommand).resolves({ MessageId: "m" });

    const out = await handler({ mode: "FIRE", reminderId: "r1" });
    expect(out.action).toBe("fired");

    const updates = ddb.commandCalls(UpdateCommand);
    const statusUpd = updates.find((u) =>
      String((u.args[0].input as { UpdateExpression?: string }).UpdateExpression ?? "").includes("#s"),
    );
    expect(statusUpd).toBeTruthy();
  });
});

// -------------------- chatbot-handler (rate-limit path) --------------------
describe("chatbot-handler", () => {
  it("returns rate-limit message when user exceeds SystemSettings cap", async () => {
    const { handler } = await import("../../amplify/functions/chatbot-handler/handler.js");
    ddb.on(GetCommand).resolves({
      Item: {
        id: "sess1",
        userId: "user1",
        startedAt: new Date().toISOString(),
        messagesInWindow: 10,
        ratelimitWindowStart: new Date(Date.now() - 10_000).toISOString(),
      },
    });
    ddb.on(ScanCommand).resolves({
      Items: [{ chatbotRateLimitPerMin: 10 }],
    });

    const out = await handler({
      userId: "user1",
      message: "hi",
      sessionId: "sess1",
    });
    expect(out.rateLimited).toBe(true);
    expect(out.reply).toMatch(/Rate limit/);
  });
});

// -------------------- boq-parser --------------------
describe("boq-parser", () => {
  it("parses a simple in-memory xlsx and matches products", async () => {
    const { handler } = await import("../../amplify/functions/boq-parser/handler.js");

    // Build a tiny in-memory xlsx.
    const sheet = XLSX.utils.aoa_to_sheet([
      ["Item Description", "Quantity", "Rate", "HSN"],
      ["LG Signage Display 55UR640S", 2, 45000, "85287200"],
      ["Unknown Widget XYZ", 1, 100, "AB"],
    ]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, sheet, "BOQ");
    const bytes = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as Uint8Array;

    s3.on(GetObjectCommand).resolves({
      Body: { transformToByteArray: async () => bytes } as never,
    });
    ddb.on(ScanCommand).resolves({
      Items: [{ id: "p1", productName: "LG Signage Display 55UR640S" }],
    });

    const out = await handler({ s3Bucket: "b", s3Key: "boq.xlsx" });

    expect(out.totalLines).toBe(2);
    expect(out.matched).toBe(1);
    expect(out.unmatched).toBe(1);
    expect(out.hsnWarnings).toBe(1); // "AB" is malformed
    expect(out.lineItems[0]!.matchedProductId).toBe("p1");
    expect(out.lineItems[0]!.hsnValid).toBe(true);
  });
});
