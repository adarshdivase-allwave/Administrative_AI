/**
 * DynamoDB helpers with the Amplify Gen 2 naming convention.
 *
 * Amplify Gen 2 generates table names like `{ModelName}-{apiId}-{env}`.
 * The actual resolved name is injected into Lambda env vars by Amplify under
 * keys shaped `AMPLIFY_DATA_{MODEL}_TABLE_NAME` (auto-set when the Lambda is
 * granted data access). These helpers normalize that lookup.
 */
import {
  GetCommand,
  PutCommand,
  UpdateCommand,
  DeleteCommand,
  QueryCommand,
  ScanCommand,
  BatchWriteCommand,
  type UpdateCommandInput,
  type QueryCommandInput,
  type ScanCommandInput,
} from "@aws-sdk/lib-dynamodb";
import { DynamoDBClient, ListTablesCommand } from "@aws-sdk/client-dynamodb";
import { ddbClient } from "./aws-clients.js";

/**
 * Resolves the DynamoDB table name for a given Amplify model.
 *
 * Resolution order:
 *   1. Env var `AMPLIFY_DATA_{MODEL}_TABLE_NAME` — set for Lambdas in the data
 *      stack via `lambda-data-access.ts`.
 *   2. Module-level cache populated on cold start by runtime discovery
 *      (ListTables + prefix match) — used for function-stack Lambdas that
 *      can't receive specific table-name env vars due to CloudFormation
 *      cross-stack circular-dependency constraints.
 *   3. Fallback `{Model}-{env}` naming — used in tests + local dev.
 *
 * When called from a function-stack Lambda, `ensureTableRegistry()` MUST be
 * awaited once on cold start (see `wrapDdb()` below — all helpers do this).
 */
export function tableName(modelName: string): string {
  const envKey = `AMPLIFY_DATA_${modelName.toUpperCase()}_TABLE_NAME`;
  const fromEnv = process.env[envKey];
  if (fromEnv && fromEnv.length > 0) return fromEnv;
  const fromCache = tableRegistry.get(modelName);
  if (fromCache) return fromCache;
  const appEnv = process.env.APP_ENV ?? "dev";
  return `${modelName}-${appEnv}`;
}

// ---------- Runtime table-name discovery ----------

const tableRegistry = new Map<string, string>();
let registryPromise: Promise<void> | null = null;

async function populateRegistry(): Promise<void> {
  // Only ever run once per cold start.
  const client = new DynamoDBClient({});
  let ExclusiveStartTableName: string | undefined;
  const allNames: string[] = [];
  do {
    const res = await client.send(
      new ListTablesCommand({ ExclusiveStartTableName, Limit: 100 }),
    );
    allNames.push(...(res.TableNames ?? []));
    ExclusiveStartTableName = res.LastEvaluatedTableName;
  } while (ExclusiveStartTableName);

  // Amplify's table naming: `{ModelName}-{apiId}-{env}` — e.g.
  // `HSNDatabase-y4mj6rjjjfekvc2ipdo6hmwb5i-NONE`.
  // Match by "{ModelName}-" prefix, picking the LONGEST match to win
  // over accidental prefix overlaps (e.g. "Client" vs "ClientInvoice").
  for (const name of allNames) {
    const match = /^([A-Z][A-Za-z]+)-[a-z0-9]+-[A-Za-z]+$/.exec(name);
    if (!match) continue;
    const [, model] = match;
    if (!model) continue;
    const existing = tableRegistry.get(model);
    if (!existing || name.length > existing.length) {
      tableRegistry.set(model, name);
    }
  }
}

/**
 * Populates the module-level table-name cache once per cold start.
 * No-op for Lambdas that don't enable runtime discovery.
 */
export async function ensureTableRegistry(): Promise<void> {
  if (process.env.AMPLIFY_DATA_RUNTIME_DISCOVERY !== "1") return;
  if (!registryPromise) {
    registryPromise = populateRegistry().catch((e) => {
      console.error("[_lib/ddb] runtime discovery failed:", e);
      registryPromise = null;
      throw e;
    });
  }
  await registryPromise;
}

// ---------- Thin wrappers that return raw data, not command metadata ----------
// Every helper awaits `ensureTableRegistry()` first, which is a no-op except
// on cold starts of function-stack Lambdas.

export async function getItem<T = Record<string, unknown>>(
  modelName: string,
  key: Record<string, unknown>,
): Promise<T | undefined> {
  await ensureTableRegistry();
  const res = await ddbClient().send(
    new GetCommand({ TableName: tableName(modelName), Key: key }),
  );
  return res.Item as T | undefined;
}

export async function putItem<T extends Record<string, unknown>>(
  modelName: string,
  item: T,
  options: { conditionExpression?: string; expressionAttributeNames?: Record<string, string> } = {},
): Promise<void> {
  await ensureTableRegistry();
  await ddbClient().send(
    new PutCommand({
      TableName: tableName(modelName),
      Item: item,
      ConditionExpression: options.conditionExpression,
      ExpressionAttributeNames: options.expressionAttributeNames,
    }),
  );
}

export async function updateItem(
  modelName: string,
  key: Record<string, unknown>,
  input: Omit<UpdateCommandInput, "TableName" | "Key">,
): Promise<void> {
  await ensureTableRegistry();
  await ddbClient().send(
    new UpdateCommand({ TableName: tableName(modelName), Key: key, ...input }),
  );
}

export async function deleteItem(
  modelName: string,
  key: Record<string, unknown>,
): Promise<void> {
  await ensureTableRegistry();
  await ddbClient().send(
    new DeleteCommand({ TableName: tableName(modelName), Key: key }),
  );
}

export async function queryItems<T = Record<string, unknown>>(
  modelName: string,
  input: Omit<QueryCommandInput, "TableName">,
): Promise<T[]> {
  await ensureTableRegistry();
  const out: T[] = [];
  let next: Record<string, unknown> | undefined;
  do {
    const res = await ddbClient().send(
      new QueryCommand({
        TableName: tableName(modelName),
        ExclusiveStartKey: next,
        ...input,
      }),
    );
    for (const item of res.Items ?? []) out.push(item as T);
    next = res.LastEvaluatedKey as Record<string, unknown> | undefined;
  } while (next);
  return out;
}

export async function scanItems<T = Record<string, unknown>>(
  modelName: string,
  input: Omit<ScanCommandInput, "TableName"> = {},
): Promise<T[]> {
  await ensureTableRegistry();
  const out: T[] = [];
  let next: Record<string, unknown> | undefined;
  do {
    const res = await ddbClient().send(
      new ScanCommand({
        TableName: tableName(modelName),
        ExclusiveStartKey: next,
        ...input,
      }),
    );
    for (const item of res.Items ?? []) out.push(item as T);
    next = res.LastEvaluatedKey as Record<string, unknown> | undefined;
  } while (next);
  return out;
}

/** Batches writes in chunks of 25 (DynamoDB hard limit). */
export async function batchWrite(
  modelName: string,
  items: Array<{ put?: Record<string, unknown>; delete?: Record<string, unknown> }>,
): Promise<void> {
  await ensureTableRegistry();
  const table = tableName(modelName);
  for (let i = 0; i < items.length; i += 25) {
    const chunk = items.slice(i, i + 25);
    await ddbClient().send(
      new BatchWriteCommand({
        RequestItems: {
          [table]: chunk.map((req) =>
            req.put
              ? { PutRequest: { Item: req.put } }
              : { DeleteRequest: { Key: req.delete! } },
          ),
        },
      }),
    );
  }
}
