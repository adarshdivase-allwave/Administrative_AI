import { describe, it, beforeEach, expect } from "../helpers/test-shim.js";
import { mockClient } from "aws-sdk-client-mock";
import {
  DynamoDBDocumentClient,
  GetCommand,
  QueryCommand,
  ScanCommand,
  UpdateCommand,
  PutCommand,
} from "@aws-sdk/lib-dynamodb";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { _resetClientsForTests } from "../../amplify/functions/_lib/aws-clients.js";
import { handler } from "../../amplify/functions/tally-export-generator/handler.js";

const ddbMock = mockClient(DynamoDBDocumentClient);
const s3Mock = mockClient(S3Client);

const FULL_LEDGER_MAP = {
  companyGstin: "27AAPFU0939F1ZV",
  tallyPurchaseLedgerName: "Purchase Accounts",
  tallySalesLedgerName: "Sales Accounts",
  tallyCgstLedgerName: "CGST 9%",
  tallySgstLedgerName: "SGST 9%",
  tallyIgstLedgerName: "IGST 18%",
  tallyVendorNameMap: { "vendor-1": "Acme Traders" },
  tallyClientNameMap: { "client-1": "Beta Corp" },
};

beforeEach(() => {
  ddbMock.reset();
  s3Mock.reset();
  _resetClientsForTests();
  process.env.PRIVATE_BUCKET_NAME = "test-bucket";
  process.env.AWS_REGION = "ap-south-1";
});

describe("tally-export-generator", () => {
  it("blocks when SystemSettings row is missing", async () => {
    ddbMock.on(ScanCommand).resolves({ Items: [] });
    const err = await handler({ kind: "GRN", grnId: "g1" }).catch((e: Error) => e.message);
    expect(err).toMatch(/SystemSettings/);
  });

  it("emits a Purchase Voucher for a GRN with units", async () => {
    ddbMock
      .on(ScanCommand, { TableName: "SystemSettings-dev", Limit: 1 } as never)
      .resolves({ Items: [FULL_LEDGER_MAP] });

    // GRN record
    ddbMock.on(GetCommand).callsFake((input) => {
      const tbl = (input as { TableName?: string }).TableName ?? "";
      if (tbl.startsWith("GoodsReceivedNote")) {
        return {
          Item: {
            id: "g1",
            grnNumber: "GRN-2526-00001",
            grnDate: "2025-06-15",
            vendorId: "vendor-1",
            vendorGstin: "27AAPFU0939F1ZV",
            intrastate: true,
          },
        };
      }
      if (tbl.startsWith("ProductMaster")) {
        return {
          Item: {
            id: "p1",
            productName: "LG 55UR640S",
            modelNumber: "55UR640S",
            gstRatePercent: 18,
          },
        };
      }
      return {};
    });

    // Units under GRN
    ddbMock.on(QueryCommand).resolves({
      Items: [
        {
          productId: "p1",
          hsnTallyFormat: "85287200",
          purchasePrice: 45000,
        },
        {
          productId: "p1",
          hsnTallyFormat: "85287200",
          purchasePrice: 45000,
        },
      ],
    });

    ddbMock.on(UpdateCommand).resolves({});
    ddbMock.on(PutCommand).resolves({}); // AuditLog put
    s3Mock.on(PutObjectCommand).resolves({});

    const out = await handler({ kind: "GRN", grnId: "g1", actorUserId: "user-1" });

    expect(out.voucherCount).toBe(1);
    expect(out.s3Key).toMatch(/^tally-exports\/grn\//);
    expect(out.xmlSize).toBeGreaterThan(100);
    expect(s3Mock.commandCalls(PutObjectCommand).length).toBe(1);
    const putCall = s3Mock.commandCalls(PutObjectCommand)[0]!;
    const body = String(putCall.args[0].input.Body);
    expect(body).toContain('<VOUCHER VCHTYPE="Purchase"');
    expect(body).toContain("GRN-2526-00001");
    expect(body).toContain("Acme Traders");
    expect(body).toContain("CGST 9%"); // intrastate

    // AuditLog write
    expect(ddbMock.commandCalls(PutCommand).length).toBe(1);
  });

  it("refuses to export a DRAFT DC", async () => {
    ddbMock.on(ScanCommand).resolves({ Items: [FULL_LEDGER_MAP] });
    ddbMock.on(GetCommand).resolves({
      Item: {
        id: "dc1",
        dcNumber: "DC-2526-00001",
        dcDate: "2025-06-20",
        clientId: "client-1",
        status: "DRAFT",
      },
    });
    const err = await handler({
      kind: "DC",
      dcId: "dc1",
      voucherType: "Sales",
    }).catch((e: Error) => e.message);
    expect(err).toMatch(/DRAFT/);
  });

  it("blocks when a vendor has no Tally ledger mapping", async () => {
    ddbMock.on(ScanCommand).resolves({
      Items: [{ ...FULL_LEDGER_MAP, tallyVendorNameMap: {} }],
    });
    ddbMock.on(GetCommand).callsFake((input) => {
      const tbl = (input as { TableName?: string }).TableName ?? "";
      if (tbl.startsWith("GoodsReceivedNote")) {
        return {
          Item: {
            id: "g1",
            grnNumber: "GRN-2526-00002",
            grnDate: "2025-06-15",
            vendorId: "unknown-vendor",
            intrastate: true,
          },
        };
      }
      if (tbl.startsWith("ProductMaster")) {
        return { Item: { id: "p1", productName: "x", gstRatePercent: 18 } };
      }
      return {};
    });
    ddbMock.on(QueryCommand).resolves({
      Items: [{ productId: "p1", hsnTallyFormat: "85287200", purchasePrice: 1000 }],
    });

    const err = await handler({ kind: "GRN", grnId: "g1" }).catch((e: Error) => e.message);
    // Either error path is acceptable — the top-level assertLedgers fires
    // before the per-vendor lookup because an empty map counts as "missing".
    expect(err).toMatch(/vendorTallyNameMap|Tally ledger name mapped for vendor/);
  });
});
