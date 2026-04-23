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
import { ddbClient } from "./aws-clients.js";

/**
 * Resolves the DynamoDB table name for a given Amplify model.
 * Env var shape: `AMPLIFY_DATA_{MODEL}_TABLE_NAME` — Amplify Gen 2 injects
 * these automatically into Lambdas that list the model in their data access.
 * Falls back to `{Model}-{env}` naming if the env var is missing (useful for
 * tests + local sandbox).
 */
export function tableName(modelName: string): string {
  const envKey = `AMPLIFY_DATA_${modelName.toUpperCase()}_TABLE_NAME`;
  const fromEnv = process.env[envKey];
  if (fromEnv && fromEnv.length > 0) return fromEnv;
  const appEnv = process.env.APP_ENV ?? "dev";
  return `${modelName}-${appEnv}`;
}

// ---------- Thin wrappers that return raw data, not command metadata ----------

export async function getItem<T = Record<string, unknown>>(
  modelName: string,
  key: Record<string, unknown>,
): Promise<T | undefined> {
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
  await ddbClient().send(
    new UpdateCommand({ TableName: tableName(modelName), Key: key, ...input }),
  );
}

export async function deleteItem(
  modelName: string,
  key: Record<string, unknown>,
): Promise<void> {
  await ddbClient().send(
    new DeleteCommand({ TableName: tableName(modelName), Key: key }),
  );
}

export async function queryItems<T = Record<string, unknown>>(
  modelName: string,
  input: Omit<QueryCommandInput, "TableName">,
): Promise<T[]> {
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
