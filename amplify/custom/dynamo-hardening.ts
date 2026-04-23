/**
 * DynamoDB table hardening — applied post-synthesis to every generated
 * CfnTable in the data stack. Guarantees the three spec-mandated properties
 * on EVERY table, not just the ones the author remembered to configure.
 *
 *   1. PointInTimeRecoveryEnabled: true  (ALL envs)
 *   2. SSESpecification.SSEEnabled: true (ALL envs) — AWS-managed KMS key
 *   3. DeletionProtectionEnabled: true   (prod only — dev/staging off so
 *                                         `ampx sandbox delete` works)
 *   4. BillingMode: PAY_PER_REQUEST      (left as-is; Amplify default)
 *
 * Also applies a TTL attribute to auto-prune stale rows:
 *   - ForexRateCache  (TTL on `expiresAt`)
 *   - ClientPortalToken  (TTL on `expiresAt`, default 30-day per token)
 *   - ChatSession  (TTL on `ttl`, 90-day rolling)
 */
import { CfnTable } from "aws-cdk-lib/aws-dynamodb";
import { IConstruct } from "constructs";
import type { MinimalBackend } from "./_backend-types.js";

const TTL_MODELS: Record<string, string> = {
  ForexRateCache: "expiresAt",
  ClientPortalToken: "expiresAt",
  ChatSession: "ttl",
};

export function applyDynamoHardening(backend: MinimalBackend): void {
  const appEnv = (process.env.APP_ENV ?? "dev").toLowerCase();
  const isProd = appEnv === "prod";

  // Amplify Gen 2's data resource exposes the CfnResources under .resources.
  const resources = backend.data.resources as
    | { amplifyDynamoDbTables?: Record<string, CfnTable>; cfnResources?: unknown }
    | undefined;

  // Preferred path: walk the typed table dictionary.
  const tables = resources?.amplifyDynamoDbTables;
  if (tables) {
    for (const [modelName, table] of Object.entries(tables)) {
      hardenTable(table, isProd);
      const ttlAttr = TTL_MODELS[modelName];
      if (ttlAttr) {
        table.timeToLiveSpecification = {
          attributeName: ttlAttr,
          enabled: true,
        } as CfnTable.TimeToLiveSpecificationProperty;
      }
    }
    return;
  }

  // Fallback: walk the construct tree and harden any CfnTable we find.
  backend.data.stack.node
    .findAll()
    .filter((c: IConstruct): c is CfnTable => c instanceof CfnTable)
    .forEach((t) => hardenTable(t, isProd));
}

function hardenTable(table: CfnTable, isProd: boolean): void {
  table.pointInTimeRecoverySpecification = {
    pointInTimeRecoveryEnabled: true,
  };
  table.sseSpecification = {
    sseEnabled: true,
  };
  table.deletionProtectionEnabled = isProd;
}
