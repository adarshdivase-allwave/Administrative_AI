#!/usr/bin/env tsx
/**
 * seed-hsn — bulk-loads an India GST HSN/SAC schedule into the OpenSearch
 * `hsn-india-gst` index AND into the DynamoDB HSNDatabase table
 * (source of truth; OpenSearch is just the search layer).
 *
 * Usage:
 *   npm run seed:hsn                                           # uses default AV seed CSV
 *   npm run seed:hsn -- --file=scripts/data/hsn-full.csv       # operator's full CBIC CSV
 *   npm run seed:hsn -- --upsert --file=...                    # annual refresh path
 *
 * CSV columns (header row required):
 *   hsnCode, description, gstRatePercent, chapter, section, isSac
 *
 * Prerequisites:
 *   - `OPENSEARCH_COLLECTION_ENDPOINT` env var pointing to the collection
 *   - `AMPLIFY_DATA_HSNDATABASE_TABLE_NAME` OR `APP_ENV` env var
 *   - AWS credentials with `aoss:APIAccessAll` on the collection and
 *     `dynamodb:PutItem` on HSNDatabase table
 *
 * Safety:
 *   - Rows with invalid HSN format (per shared/hsn.ts) are skipped with a warning
 *   - Bulk-index to OpenSearch in chunks of 500
 *   - Bulk-write to DynamoDB in chunks of 25
 */
import { readFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { validateHsn } from "../shared/hsn.js";
import { batchWrite } from "../amplify/functions/_lib/ddb.js";

interface HsnRow {
  hsnCode: string;
  description: string;
  gstRatePercent: number;
  chapter?: string;
  section?: string;
  isSac?: boolean;
}

const args = parseArgs(process.argv.slice(2));
const fileArg = args.file;
const file: string =
  typeof fileArg === "string" && fileArg.length > 0
    ? fileArg
    : join(process.cwd(), "scripts", "data", "hsn-av-seed.csv");
const upsert = Boolean(args.upsert);

async function main(): Promise<void> {
  if (!existsSync(file)) {
    console.error(`HSN seed file not found: ${resolve(file)}`);
    process.exit(1);
  }

  const rows = parseCsv(readFileSync(file, "utf-8"));
  console.log(`Parsed ${rows.length} rows from ${file}`);

  const valid: HsnRow[] = [];
  for (const row of rows) {
    const v = validateHsn(row.hsnCode);
    if (!v.valid) {
      console.warn(`  skip: "${row.hsnCode}" — ${v.error}`);
      continue;
    }
    valid.push({ ...row, hsnCode: v.tallyFormat });
  }

  console.log(`${valid.length}/${rows.length} rows passed HSN format validation`);

  if (valid.length === 0) {
    console.error("No valid rows to seed — aborting.");
    process.exit(1);
  }

  // -- 1. DynamoDB ---
  await seedDynamo(valid);

  // -- 2. OpenSearch ---
  const endpoint = process.env.OPENSEARCH_COLLECTION_ENDPOINT;
  if (endpoint) {
    await seedOpenSearch(endpoint, valid);
  } else {
    console.warn(
      "OPENSEARCH_COLLECTION_ENDPOINT not set — skipping OpenSearch seed. DynamoDB still populated.",
    );
  }

  console.log(`\n✓ Seed complete: ${valid.length} HSN rows (upsert=${upsert})`);
}

async function seedDynamo(rows: HsnRow[]): Promise<void> {
  console.log(`Writing ${rows.length} rows to HSNDatabase table...`);
  const now = new Date().toISOString();
  await batchWrite(
    "HSNDatabase",
    rows.map((r) => ({
      put: {
        id: r.hsnCode,
        hsnCode: r.hsnCode,
        description: r.description,
        gstRatePercent: r.gstRatePercent,
        cgstRatePercent: r.gstRatePercent / 2,
        sgstRatePercent: r.gstRatePercent / 2,
        igstRatePercent: r.gstRatePercent,
        chapter: r.chapter,
        section: r.section,
        isSac: r.isSac ?? false,
        effectiveDate: now,
        createdAt: now,
        updatedAt: now,
      },
    })),
  );
  console.log("  ✓ DynamoDB upserted");
}

async function seedOpenSearch(endpoint: string, rows: HsnRow[]): Promise<void> {
  const index = process.env.OPENSEARCH_HSN_INDEX ?? "hsn-india-gst";
  const base = endpoint.replace(/\/$/, "");

  console.log(`Bulk-indexing ${rows.length} rows to ${base}/${index}...`);

  const CHUNK = 500;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const slice = rows.slice(i, i + CHUNK);
    const body = slice
      .flatMap((r) => [
        JSON.stringify({ index: { _index: index, _id: r.hsnCode } }),
        JSON.stringify({
          hsnCode: r.hsnCode,
          description: r.description,
          gstRatePercent: r.gstRatePercent,
          chapter: r.chapter ?? "",
          section: r.section ?? "",
          isSac: Boolean(r.isSac),
        }),
      ])
      .join("\n") + "\n";

    const res = await fetch(`${base}/_bulk`, {
      method: "POST",
      headers: { "Content-Type": "application/x-ndjson" },
      body,
    });
    if (!res.ok) {
      throw new Error(
        `OpenSearch bulk failed (chunk ${i}-${i + slice.length}): ${res.status} ${await res.text()}`,
      );
    }
    const resp = (await res.json()) as { errors?: boolean; items?: unknown[] };
    if (resp.errors) {
      console.warn(`  chunk ${i}: bulk response contains errors (partial success)`);
    } else {
      console.log(`  ✓ indexed ${slice.length} (cumulative ${i + slice.length})`);
    }
  }
  console.log("  ✓ OpenSearch indexed");
}

// ---------- utilities ----------

function parseCsv(text: string): HsnRow[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) return [];

  const header = splitCsvLine(lines[0]!).map((h) => h.trim());
  const idx = {
    hsnCode: header.indexOf("hsnCode"),
    description: header.indexOf("description"),
    gstRatePercent: header.indexOf("gstRatePercent"),
    chapter: header.indexOf("chapter"),
    section: header.indexOf("section"),
    isSac: header.indexOf("isSac"),
  };
  if (idx.hsnCode < 0 || idx.description < 0 || idx.gstRatePercent < 0) {
    throw new Error(
      `CSV must have headers: hsnCode, description, gstRatePercent (at minimum). Got: ${header.join(", ")}`,
    );
  }

  const rows: HsnRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = splitCsvLine(lines[i]!);
    const gst = Number(cells[idx.gstRatePercent]);
    if (Number.isNaN(gst)) continue;
    rows.push({
      hsnCode: String(cells[idx.hsnCode] ?? "").trim(),
      description: String(cells[idx.description] ?? "").trim(),
      gstRatePercent: gst,
      chapter: idx.chapter >= 0 ? cells[idx.chapter] : undefined,
      section: idx.section >= 0 ? cells[idx.section] : undefined,
      isSac: idx.isSac >= 0 ? String(cells[idx.isSac]).toLowerCase() === "true" : false,
    });
  }
  return rows;
}

/** Minimal CSV parser supporting double-quoted cells with commas. */
function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (ch === '"') {
      if (inQ && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        inQ = !inQ;
      }
    } else if (ch === "," && !inQ) {
      out.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out;
}

function parseArgs(argv: string[]): Record<string, string | boolean> {
  const out: Record<string, string | boolean> = {};
  for (const a of argv) {
    if (a.startsWith("--")) {
      const [k, v] = a.slice(2).split("=", 2);
      out[k!] = v ?? true;
    }
  }
  return out;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
