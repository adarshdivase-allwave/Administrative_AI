import { describe, it, beforeEach, expect } from "../helpers/test-shim.js";
import { mockClient } from "aws-sdk-client-mock";
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  UpdateCommand,
  QueryCommand,
  ScanCommand,
} from "@aws-sdk/lib-dynamodb";
import { SESv2Client, SendEmailCommand } from "@aws-sdk/client-sesv2";
import {
  SchedulerClient,
  CreateScheduleCommand,
  DeleteScheduleCommand,
  ListSchedulesCommand,
} from "@aws-sdk/client-scheduler";
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { _resetClientsForTests } from "../../amplify/functions/_lib/aws-clients.js";
import type { EventBridgeEvent } from "aws-lambda";

const ddb = mockClient(DynamoDBDocumentClient);
const ses = mockClient(SESv2Client);
const sch = mockClient(SchedulerClient);
const s3 = mockClient(S3Client);

function schedEvent(time: string): EventBridgeEvent<"Scheduled Event", unknown> {
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
  sch.reset();
  s3.reset();
  _resetClientsForTests();
  process.env.SES_FROM_EMAIL = "noreply@example.com";
  process.env.PAYMENT_REMINDER_SENDER_ARN = "arn:aws:lambda:x:y:function:z";
  process.env.SCHEDULER_INVOKE_ROLE_ARN = "arn:aws:iam::123:role/z";
  process.env.INVOICE_CONFIRMATION_SCHEDULER_ARN = "arn:aws:lambda:x:y:function:w";
  process.env.PRIVATE_BUCKET_NAME = "test-bucket";
  process.env.COMPANY_NAME = "Acme AV";
  process.env.APP_ENV = "test";
});

// -------------------- invoice-scheduler --------------------
describe("invoice-scheduler", () => {
  it("creates 8 schedules (minus past stages) on CREATE", async () => {
    const { handler } = await import("../../amplify/functions/invoice-scheduler/handler.js");
    const futureDueDate = new Date(Date.now() + 30 * 86400_000).toISOString().slice(0, 10);

    ddb.on(GetCommand).resolves({
      Item: {
        id: "inv-1",
        invoiceNumber: "INV-2526-00001",
        dueDate: futureDueDate,
      },
    });
    ddb.on(PutCommand).resolves({}); // AuditLog
    sch.on(CreateScheduleCommand).resolves({ ScheduleArn: "arn:x" });

    const out = await handler({ action: "CREATE", invoiceId: "inv-1" });

    // All 8 stages are in the future → should schedule all 8.
    expect(out.scheduled).toBe(8);
    expect(out.stages).toContain("T_MINUS_15");
    expect(out.stages).toContain("T_PLUS_45");
  });

  it("tears down schedules on CANCEL", async () => {
    const { handler } = await import("../../amplify/functions/invoice-scheduler/handler.js");
    sch.on(ListSchedulesCommand).resolves({
      Schedules: [{ Name: "inv-1-T_MINUS_15" }, { Name: "inv-1-T_ZERO" }],
    });
    sch.on(DeleteScheduleCommand).resolves({});
    ddb.on(PutCommand).resolves({});

    const out = await handler({ action: "CANCEL", invoiceId: "inv-1" });
    expect(out.deleted).toBe(2);
    expect(sch.commandCalls(DeleteScheduleCommand).length).toBe(2);
  });
});

// -------------------- payment-reminder-sender --------------------
describe("payment-reminder-sender", () => {
  it("skips PAID invoices", async () => {
    const { handler } = await import("../../amplify/functions/payment-reminder-sender/handler.js");
    ddb.on(GetCommand).resolves({ Item: { id: "i1", status: "PAID" } });
    const res = await handler({ invoiceId: "i1", stage: "T_MINUS_7" });
    expect(res.skipped).toBe("invoice_status_PAID");
    expect(ses.commandCalls(SendEmailCommand).length).toBe(0);
  });

  it("skips MSME-owned stages", async () => {
    const { handler } = await import("../../amplify/functions/payment-reminder-sender/handler.js");
    ddb.on(GetCommand).resolves({
      Item: { id: "i1", status: "OVERDUE", invoiceNumber: "INV-1" },
    });
    const res = await handler({ invoiceId: "i1", stage: "T_PLUS_30" });
    expect(res.skipped).toBe("handled_by_msme_checker");
  });

  it("sends T-15 reminder to client and logs it", async () => {
    const { handler } = await import("../../amplify/functions/payment-reminder-sender/handler.js");
    ddb.on(GetCommand).callsFake((input) => {
      const tbl = (input as { TableName?: string }).TableName ?? "";
      if (tbl.startsWith("ClientInvoice")) {
        return {
          Item: {
            id: "i1",
            invoiceNumber: "INV-2526-00001",
            dueDate: "2025-06-30",
            totalAmountInr: 118000,
            amountDueInr: 100000,
            clientId: "c1",
            status: "SENT",
          },
        };
      }
      if (tbl.startsWith("Client")) {
        return { Item: { id: "c1", name: "Beta Corp", billingEmail: "billing@beta.com" } };
      }
      return {};
    });
    ddb.on(PutCommand).resolves({});
    ddb.on(UpdateCommand).resolves({});
    ses.on(SendEmailCommand).resolves({ MessageId: "m-1" });

    const res = await handler({ invoiceId: "i1", stage: "T_MINUS_15" });
    expect(res.sent).toBe(true);

    const sesCalls = ses.commandCalls(SendEmailCommand);
    expect(sesCalls.length).toBe(1);
    const input = sesCalls[0]!.args[0].input;
    expect(input.Destination?.ToAddresses?.[0]).toBe("billing@beta.com");
    expect(input.Content?.Template?.TemplateName).toBe("PAYMENT_REMINDER_15D_TEST");
  });
});

// -------------------- msme-compliance-checker --------------------
describe("msme-compliance-checker", () => {
  it("no-ops if MSME is disabled", async () => {
    const { handler } = await import(
      "../../amplify/functions/msme-compliance-checker/handler.js"
    );
    ddb.on(ScanCommand).resolves({ Items: [{ msmeEnabled: false }] });

    await handler(schedEvent("2025-07-01T04:30:00Z"), {} as never, () => {});
    expect(ses.commandCalls(SendEmailCommand).length).toBe(0);
  });

  it("sends MSME notice with certificate attachment for qualifying invoices", async () => {
    const { handler } = await import(
      "../../amplify/functions/msme-compliance-checker/handler.js"
    );
    const old = new Date(Date.now() - 60 * 86400_000).toISOString().slice(0, 10);

    ddb.on(ScanCommand).callsFake((input) => {
      const tbl = (input as { TableName?: string }).TableName ?? "";
      if (tbl.startsWith("SystemSettings")) {
        return {
          Items: [
            {
              msmeEnabled: true,
              msmeUdyamRegistrationNumber: "UDYAM-MH-25-1234567",
              msmeCertificateS3Key: "msme/certificate.pdf",
              msmeEnterpriseClassification: "MICRO",
              msmeAutoTriggerDays: 45,
              companyName: "Acme AV",
              companyGstin: "27AAPFU0939F1ZV",
              msmeRequireAdminApproval: false,
            },
          ],
        };
      }
      if (tbl.startsWith("ClientInvoice")) {
        return {
          Items: [
            {
              id: "inv-old-1",
              invoiceNumber: "INV-2526-00001",
              invoiceDate: old,
              dueDate: old,
              totalAmountInr: 118000,
              amountDueInr: 100000,
              clientId: "c1",
              status: "OVERDUE",
              paymentTermsDays: 30,
            },
          ],
        };
      }
      return { Items: [] };
    });
    ddb.on(GetCommand).resolves({
      Item: {
        id: "c1",
        name: "Beta Corp",
        billingEmail: "billing@beta.com",
        billingAddressLine1: "123 Main",
        billingCity: "Bangalore",
      },
    });
    ddb.on(PutCommand).resolves({});
    ddb.on(UpdateCommand).resolves({});
    ses.on(SendEmailCommand).resolves({ MessageId: "msme-1" });

    // S3 returns a byte body for the certificate attachment.
    s3.on(GetObjectCommand).resolves({
      Body: {
        transformToByteArray: async () => new Uint8Array([0x25, 0x50, 0x44, 0x46]), // "%PDF" magic
      } as never,
    });

    await handler(schedEvent("2025-07-01T04:30:00Z"), {} as never, () => {});

    expect(ses.commandCalls(SendEmailCommand).length).toBe(1);
    const input = ses.commandCalls(SendEmailCommand)[0]!.args[0].input;
    // Raw MIME path — Content.Raw should be set, not Template.
    expect(Boolean(input.Content?.Raw)).toBe(true);
  });
});

// -------------------- tds-auto-creator --------------------
describe("tds-auto-creator", () => {
  it("creates a TDS bill for the previous month due on 7th", async () => {
    const { handler } = await import("../../amplify/functions/tds-auto-creator/handler.js");
    ddb.on(GetCommand).resolves({}); // idempotency: no existing
    ddb.on(PutCommand).resolves({});

    // May 1 IST run → deductions for April, due 7 May
    await handler(schedEvent("2025-04-30T18:45:00Z"), {} as never, () => {});

    const puts = ddb.commandCalls(PutCommand);
    // One Bill put + one AuditLog put
    expect(puts.length).toBe(2);
    const billPut = puts.find((p) =>
      String((p.args[0].input as { TableName?: string }).TableName ?? "").startsWith("Bill"),
    );
    expect(billPut).toBeTruthy();
    const item = billPut!.args[0].input.Item as Record<string, unknown>;
    expect(item.billType).toBe("TDS");
    expect(String(item.id)).toMatch(/TDS-2025-04/);
    expect(String(item.description)).toMatch(/April 2025/);
  });

  it("is idempotent (skips when already exists)", async () => {
    const { handler } = await import("../../amplify/functions/tds-auto-creator/handler.js");
    ddb.on(GetCommand).resolves({
      Item: { id: "TDS-2025-04", billType: "TDS" },
    });
    ddb.on(PutCommand).resolves({});

    await handler(schedEvent("2025-04-30T18:45:00Z"), {} as never, () => {});
    // No puts should have happened
    expect(ddb.commandCalls(PutCommand).length).toBe(0);
  });
});

// -------------------- invoice-confirmation-scheduler --------------------
describe("invoice-confirmation-scheduler", () => {
  it("creates D3/D7/D10 schedules on CREATE", async () => {
    const { handler } = await import(
      "../../amplify/functions/invoice-confirmation-scheduler/handler.js"
    );
    ddb.on(GetCommand).resolves({
      Item: {
        id: "i1",
        invoiceNumber: "INV-1",
        invoiceDate: new Date().toISOString().slice(0, 10),
        dueDate: new Date(Date.now() + 30 * 86400_000).toISOString().slice(0, 10),
        totalAmountInr: 100,
        clientId: "c1",
      },
    });
    ddb.on(QueryCommand).rejects(new Error("no GSI"));
    ddb.on(ScanCommand).resolves({ Items: [] });
    ddb.on(PutCommand).resolves({});
    sch.on(ListSchedulesCommand).resolves({ Schedules: [] });
    sch.on(DeleteScheduleCommand).resolves({});
    sch.on(CreateScheduleCommand).resolves({ ScheduleArn: "x" });

    const out = await handler({ mode: "CREATE", invoiceId: "i1" });
    expect(out.action).toBe("created");
    expect(sch.commandCalls(CreateScheduleCommand).length).toBe(3);
  });

  it("FIRE_STAGE at D_10 sets status to AUTO_ACCEPTED and emails", async () => {
    const { handler } = await import(
      "../../amplify/functions/invoice-confirmation-scheduler/handler.js"
    );
    ddb.on(GetCommand).callsFake((input) => {
      const tbl = (input as { TableName?: string }).TableName ?? "";
      if (tbl.startsWith("ClientInvoice")) {
        return {
          Item: {
            id: "i1",
            invoiceNumber: "INV-1",
            invoiceDate: "2025-06-01",
            dueDate: "2025-07-01",
            totalAmountInr: 100,
            clientId: "c1",
          },
        };
      }
      if (tbl.startsWith("Client")) {
        return { Item: { id: "c1", name: "Beta", billingEmail: "b@b.com" } };
      }
      return {};
    });
    ddb.on(QueryCommand).rejects(new Error("no GSI"));
    ddb.on(ScanCommand).resolves({
      Items: [
        { id: "conf-1", invoiceId: "i1", status: "PENDING", confirmationToken: "tok" },
      ],
    });
    ddb.on(UpdateCommand).resolves({});
    ddb.on(PutCommand).resolves({});
    ses.on(SendEmailCommand).resolves({ MessageId: "m-accept" });

    const out = await handler({
      mode: "FIRE_STAGE",
      invoiceId: "i1",
      stage: "D_10_AUTO_ACCEPTANCE",
    });
    expect(out.action).toBe("auto_accepted");
    const seCalls = ses.commandCalls(SendEmailCommand);
    expect(seCalls[0]!.args[0].input.Content?.Template?.TemplateName).toBe(
      "INVOICE_AUTO_ACCEPTANCE_TEST",
    );
  });
});
