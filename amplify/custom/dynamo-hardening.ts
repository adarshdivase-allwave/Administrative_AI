/**
 * DynamoDB table hardening — applied post-synthesis to every Amplify-created
 * table. Guarantees spec-mandated properties on EVERY table, not just the ones
 * the author remembered to configure.
 *
 *   1. PointInTimeRecoveryEnabled: true  (ALL envs)
 *   2. SSESpecification.SSEEnabled: true (ALL envs) — AWS-managed KMS key
 *   3. DeletionProtectionEnabled: true   (prod only — dev/staging off so
 *                                         `ampx sandbox delete` works)
 *
 * Plus TTL on rows that should expire:
 *   - ForexRateCache    (`expiresAt`)
 *   - ClientPortalToken (`expiresAt`)
 *   - ChatSession       (`ttl`)
 *
 * Amplify Gen 2 does NOT expose the underlying `CfnTable` via
 * `backend.data.resources.cfnResources.amplifyDynamoDbTables` in recent
 * versions. Instead, the L2 ITable is at `backend.data.resources.tables`.
 * We unwrap to the CfnTable via `node.defaultChild`.
 */
import type { CfnTable, ITable, Table } from "aws-cdk-lib/aws-dynamodb";
import type { MinimalBackend } from "./_backend-types.js";

const TTL_MODELS: Record<string, string> = {
  ForexRateCache: "expiresAt",
  ClientPortalToken: "expiresAt",
  ChatSession: "ttl",
};

export function applyDynamoHardening(backend: MinimalBackend): void {
  const appEnv = (process.env.APP_ENV ?? "dev").toLowerCase();
  const isProd = appEnv === "prod";

  const resources = backend.data.resources as
    | { tables?: Record<string, ITable> }
    | undefined;
  const tables = resources?.tables;
  if (!tables || Object.keys(tables).length === 0) {
    console.warn("[dynamo-hardening] No tables found on backend.data.resources.");
    return;
  }

  let hardened = 0;
  for (const [modelName, iTable] of Object.entries(tables)) {
    // L2 Table wraps L1 CfnTable at .node.defaultChild
    const tableAsL2 = iTable as Table;
    const cfnTable = tableAsL2.node.defaultChild as CfnTable | undefined;
    if (!cfnTable) continue;

    cfnTable.pointInTimeRecoverySpecification = {
      pointInTimeRecoveryEnabled: true,
    };
    cfnTable.sseSpecification = { sseEnabled: true };
    cfnTable.deletionProtectionEnabled = isProd;

    const ttlAttr = TTL_MODELS[modelName];
    if (ttlAttr) {
      cfnTable.timeToLiveSpecification = {
        attributeName: ttlAttr,
        enabled: true,
      } as CfnTable.TimeToLiveSpecificationProperty;
    }
    hardened++;
  }
  console.log(
    `[dynamo-hardening] Hardened ${hardened}/${Object.keys(tables).length} tables (PITR+SSE, deletionProtection=${isProd}).`,
  );
}
