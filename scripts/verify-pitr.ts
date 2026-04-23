#!/usr/bin/env tsx
/**
 * verify-pitr — audits every DynamoDB table in the current environment for
 * the three spec-mandated guarantees:
 *
 *   1. ContinuousBackupsStatus + PointInTimeRecoveryStatus = ENABLED
 *   2. SSEDescription.Status = ENABLED
 *   3. DeletionProtectionEnabled = true (prod only; dev/staging must be false so
 *      `ampx sandbox delete` can tear down)
 *
 * Exits with non-zero code if any table fails, for CI pipeline integration.
 *
 * Usage:
 *   AWS_REGION=ap-south-1 APP_ENV=prod npm run verify:pitr
 */
import {
  DynamoDBClient,
  ListTablesCommand,
  DescribeTableCommand,
  DescribeContinuousBackupsCommand,
} from "@aws-sdk/client-dynamodb";

const REGION = process.env.AWS_REGION ?? "ap-south-1";
const APP_ENV = (process.env.APP_ENV ?? "dev").toLowerCase();
const ENV_FILTER = process.env.TABLE_FILTER ?? "";
const isProd = APP_ENV === "prod";

const ddb = new DynamoDBClient({ region: REGION });

interface Finding {
  table: string;
  pitr: "OK" | "FAIL";
  sse: "OK" | "FAIL";
  deletionProtection: "OK" | "FAIL" | "N/A";
  error?: string;
}

async function main(): Promise<void> {
  console.log(`Auditing DynamoDB tables in ${REGION} (APP_ENV=${APP_ENV})...`);
  const tables = await listTables();
  // Filter to just our app's tables (Amplify names them `{Model}-{apiId}-{env}`).
  const relevant = tables.filter((t) => (ENV_FILTER ? t.includes(ENV_FILTER) : true));
  console.log(`Found ${relevant.length} tables to audit.\n`);

  const findings: Finding[] = [];
  for (const t of relevant) {
    findings.push(await auditTable(t));
  }

  // --- Render report ---
  const col = (s: string, n: number) => s.padEnd(n);
  console.log(col("Table", 56) + col("PITR", 8) + col("SSE", 8) + col("Deletion", 10));
  console.log("-".repeat(82));
  for (const f of findings) {
    const line =
      col(f.table, 56) +
      col(f.pitr, 8) +
      col(f.sse, 8) +
      col(f.deletionProtection, 10);
    console.log(line);
  }
  console.log("-".repeat(82));

  const failed = findings.filter(
    (f) =>
      f.pitr === "FAIL" ||
      f.sse === "FAIL" ||
      (isProd && f.deletionProtection === "FAIL"),
  );
  if (failed.length > 0) {
    console.error(`\n✖ ${failed.length} table(s) FAILED hardening checks.`);
    process.exit(1);
  }
  console.log(`\n✓ All ${findings.length} tables pass hardening requirements (APP_ENV=${APP_ENV}).`);
}

async function listTables(): Promise<string[]> {
  const out: string[] = [];
  let next: string | undefined;
  do {
    const res = await ddb.send(new ListTablesCommand({ ExclusiveStartTableName: next }));
    out.push(...(res.TableNames ?? []));
    next = res.LastEvaluatedTableName;
  } while (next);
  return out;
}

async function auditTable(name: string): Promise<Finding> {
  try {
    const [desc, cb] = await Promise.all([
      ddb.send(new DescribeTableCommand({ TableName: name })),
      ddb.send(new DescribeContinuousBackupsCommand({ TableName: name })),
    ]);

    const pitrOn =
      cb.ContinuousBackupsDescription?.PointInTimeRecoveryDescription
        ?.PointInTimeRecoveryStatus === "ENABLED";
    const sseOn = desc.Table?.SSEDescription?.Status === "ENABLED";
    const delProt = Boolean(desc.Table?.DeletionProtectionEnabled);

    return {
      table: name,
      pitr: pitrOn ? "OK" : "FAIL",
      sse: sseOn ? "OK" : "FAIL",
      deletionProtection: isProd ? (delProt ? "OK" : "FAIL") : "N/A",
    };
  } catch (e) {
    return {
      table: name,
      pitr: "FAIL",
      sse: "FAIL",
      deletionProtection: "FAIL",
      error: (e as Error).message,
    };
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
