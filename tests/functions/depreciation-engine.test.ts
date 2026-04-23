import { describe, it, beforeEach, expect } from "../helpers/test-shim.js";
import { mockClient } from "aws-sdk-client-mock";
import {
  DynamoDBDocumentClient,
  ScanCommand,
  QueryCommand,
  PutCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import { _resetClientsForTests } from "../../amplify/functions/_lib/aws-clients.js";
import { handler } from "../../amplify/functions/depreciation-engine/handler.js";
import type { EventBridgeEvent } from "aws-lambda";

const ddb = mockClient(DynamoDBDocumentClient);

function scheduledEvent(time: string): EventBridgeEvent<"Scheduled Event", unknown> {
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
  _resetClientsForTests();
});

describe("depreciation-engine", () => {
  it("no-ops when no ASSET units exist", async () => {
    ddb.on(ScanCommand).resolves({ Items: [] });
    ddb.on(PutCommand).resolves({}); // audit

    await handler(scheduledEvent("2025-05-01T01:00:00Z"), {} as never, () => {});

    // Only the AuditLog put should fire.
    expect(ddb.commandCalls(PutCommand).length).toBe(1);
    expect(ddb.commandCalls(UpdateCommand).length).toBe(0);
  });

  it("processes each asset and writes a DepreciationRecord + UpdateItem", async () => {
    ddb.on(ScanCommand).resolves({
      Items: [
        {
          id: "u1",
          inventoryCategory: "ASSET",
          depreciationModel: "STRAIGHT_LINE",
          purchasePrice: 120_000,
          salvageValue: 0,
          usefulLifeYears: 5,
          purchaseDate: "2024-04-01",
          currentBookValue: 120_000,
        },
        {
          id: "u2",
          inventoryCategory: "ASSET",
          depreciationModel: "DECLINING_BALANCE",
          purchasePrice: 60_000,
          salvageValue: 10_000,
          usefulLifeYears: 5,
          purchaseDate: "2024-04-01",
          currentBookValue: 48_000,
        },
      ],
    });

    // Idempotency query — no existing records.
    ddb.on(QueryCommand).resolves({ Items: [] });
    ddb.on(PutCommand).resolves({});
    ddb.on(UpdateCommand).resolves({});

    await handler(scheduledEvent("2025-05-01T01:00:00Z"), {} as never, () => {});

    // 2 DepreciationRecord puts + 1 AuditLog put = 3 total Put calls.
    expect(ddb.commandCalls(PutCommand).length).toBe(3);
    expect(ddb.commandCalls(UpdateCommand).length).toBe(2);
  });

  it("skips units with incomplete depreciation config", async () => {
    ddb.on(ScanCommand).resolves({
      Items: [
        {
          id: "u1",
          inventoryCategory: "ASSET",
          // Missing usefulLifeYears + depreciationModel + purchaseDate + purchasePrice
        },
      ],
    });
    ddb.on(QueryCommand).resolves({ Items: [] });
    ddb.on(PutCommand).resolves({});

    await handler(scheduledEvent("2025-05-01T01:00:00Z"), {} as never, () => {});

    // Just the audit row, no DepreciationRecord, no UpdateItem.
    expect(ddb.commandCalls(PutCommand).length).toBe(1);
    expect(ddb.commandCalls(UpdateCommand).length).toBe(0);
  });

  it("is idempotent (skips a second run in the same month)", async () => {
    ddb.on(ScanCommand).resolves({
      Items: [
        {
          id: "u1",
          inventoryCategory: "ASSET",
          depreciationModel: "STRAIGHT_LINE",
          purchasePrice: 120_000,
          salvageValue: 0,
          usefulLifeYears: 5,
          purchaseDate: "2024-04-01",
          currentBookValue: 120_000,
        },
      ],
    });
    // Pretend the DepreciationRecord already exists for this (unit, month).
    ddb.on(QueryCommand).resolves({ Items: [{ id: "u1#2025-05" }] });
    ddb.on(PutCommand).resolves({});
    ddb.on(UpdateCommand).resolves({});

    await handler(scheduledEvent("2025-05-01T01:00:00Z"), {} as never, () => {});

    // Only audit, no new DepreciationRecord, no update.
    expect(ddb.commandCalls(PutCommand).length).toBe(1);
    expect(ddb.commandCalls(UpdateCommand).length).toBe(0);
  });
});
