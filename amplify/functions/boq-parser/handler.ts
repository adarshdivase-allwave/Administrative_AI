/**
 * boq-parser — Bill Of Quantity spreadsheet → normalized PO-ready line items.
 *
 * Input (AppSync resolver):
 *   {
 *     s3Bucket: string,
 *     s3Key: string,             // .xlsx or .csv
 *     columnMapping?: {          // optional; auto-detected if omitted
 *       description: string,     // column header for "Item Description"
 *       quantity: string,
 *       unitRate?: string,
 *       hsn?: string,
 *     },
 *     boqUploadId?: string,      // updates BOQUpload row on finish
 *   }
 *
 * Output:
 *   {
 *     totalLines: number,
 *     matched: number,
 *     unmatched: number,
 *     hsnWarnings: number,
 *     lineItems: Array<NormalizedLine>,
 *     previewCsv?: string,
 *   }
 *
 * Matching algorithm:
 *   - Fuzzy match description against ProductMaster.productName using
 *     Levenshtein distance ratio (≥ 0.75 confidence = auto-match).
 *   - If HSN column present, each line is validated via shared/hsn.ts.
 *     Invalid HSNs are flagged but do not block the parse — the downstream
 *     PO creation UI lets Purchase fix them.
 */
import * as XLSX from "xlsx";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { s3Client } from "../_lib/aws-clients.js";
import { scanItems, updateItem } from "../_lib/ddb.js";
import { validateHsn } from "../../../shared/hsn.js";

interface Input {
  s3Bucket: string;
  s3Key: string;
  columnMapping?: {
    description: string;
    quantity: string;
    unitRate?: string;
    hsn?: string;
  };
  boqUploadId?: string;
}

export interface NormalizedLine {
  sourceRow: number;
  description: string;
  quantity: number;
  unitRate?: number;
  lineTotal?: number;
  hsn?: string;
  hsnValid?: boolean;
  hsnTallyFormat?: string;
  matchedProductId?: string;
  matchedProductName?: string;
  matchConfidence?: number;
  warnings: string[];
}

export interface Output {
  totalLines: number;
  matched: number;
  unmatched: number;
  hsnWarnings: number;
  lineItems: NormalizedLine[];
}

const MATCH_THRESHOLD = 0.75;

export const handler = async (event: Input): Promise<Output> => {
  if (!event?.s3Bucket || !event.s3Key) {
    throw new Error("s3Bucket and s3Key are required");
  }

  const fileBytes = await loadS3Object(event.s3Bucket, event.s3Key);
  const rows = parseSpreadsheet(fileBytes, event.s3Key);
  if (!rows.length) {
    throw new Error("Spreadsheet is empty or unreadable");
  }

  const mapping = event.columnMapping ?? autoDetectColumns(rows[0]!);
  if (!mapping) {
    throw new Error(
      "Could not auto-detect column mapping — please provide columnMapping explicitly.",
    );
  }

  const products = await scanItems<{
    id: string;
    productName?: string;
    hsnCode?: string;
  }>("ProductMaster");

  const lineItems: NormalizedLine[] = [];
  let matched = 0;
  let hsnWarnings = 0;

  // sheet_to_json returns one object per data row (headers become keys),
  // so we iterate from 0 — not 1. The `autoDetectColumns` call above used
  // rows[0] only to discover header names, not to consume the row.
  for (let i = 0; i < rows.length; i++) {
    const raw = rows[i]!;
    const description = String(raw[mapping.description] ?? "").trim();
    if (!description) continue;

    const quantity = Number(raw[mapping.quantity] ?? 0);
    const unitRate = mapping.unitRate ? Number(raw[mapping.unitRate]) || undefined : undefined;
    const hsn = mapping.hsn ? String(raw[mapping.hsn] ?? "").trim() : undefined;

    const warnings: string[] = [];
    const line: NormalizedLine = {
      // +2 to account for both 0-indexing and the header row in the
      // spreadsheet (so users see the same row number as in Excel).
      sourceRow: i + 2,
      description,
      quantity,
      unitRate,
      lineTotal: unitRate ? Math.round(unitRate * quantity * 100) / 100 : undefined,
      hsn,
      warnings,
    };

    // HSN validation.
    if (hsn) {
      const v = validateHsn(hsn);
      line.hsnValid = v.valid;
      line.hsnTallyFormat = v.tallyFormat;
      if (!v.valid) {
        warnings.push(`Invalid HSN: ${v.error}`);
        hsnWarnings++;
      }
    }

    // Fuzzy product match.
    let best: { id: string; name: string; score: number } | null = null;
    for (const p of products) {
      if (!p.productName) continue;
      const score = similarity(description, p.productName);
      if (!best || score > best.score) {
        best = { id: p.id, name: p.productName, score };
      }
    }
    if (best && best.score >= MATCH_THRESHOLD) {
      line.matchedProductId = best.id;
      line.matchedProductName = best.name;
      line.matchConfidence = Math.round(best.score * 100) / 100;
      matched++;
    } else {
      warnings.push(
        best
          ? `No close ProductMaster match (best: "${best.name}" @ ${Math.round(best.score * 100)}%)`
          : "No ProductMaster candidates",
      );
    }

    lineItems.push(line);
  }

  if (event.boqUploadId) {
    await updateItem("BOQUpload", { id: event.boqUploadId }, {
      UpdateExpression:
        "SET #s = :s, parsedLineCount = :p, unmatchedLineCount = :u, updatedAt = :t",
      ExpressionAttributeNames: { "#s": "status" },
      ExpressionAttributeValues: {
        ":s": "PARSED",
        ":p": lineItems.length,
        ":u": lineItems.length - matched,
        ":t": new Date().toISOString(),
      },
    }).catch(() => undefined);
  }

  return {
    totalLines: lineItems.length,
    matched,
    unmatched: lineItems.length - matched,
    hsnWarnings,
    lineItems,
  };
};

async function loadS3Object(bucket: string, key: string): Promise<Uint8Array> {
  const res = await s3Client().send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  const body = res.Body as { transformToByteArray?: () => Promise<Uint8Array> } | undefined;
  if (!body?.transformToByteArray) throw new Error("S3 body not streamable");
  return body.transformToByteArray();
}

function parseSpreadsheet(bytes: Uint8Array, fileName: string): Record<string, unknown>[] {
  const lower = fileName.toLowerCase();
  if (!lower.endsWith(".xlsx") && !lower.endsWith(".csv")) {
    throw new Error("Only .xlsx or .csv files are supported");
  }
  const wb = XLSX.read(bytes, { type: "array" });
  const sheetName = wb.SheetNames[0];
  if (!sheetName) throw new Error("Workbook has no sheets");
  const sheet = wb.Sheets[sheetName]!;
  return XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" });
}

function autoDetectColumns(
  firstRow: Record<string, unknown>,
): Input["columnMapping"] | null {
  const headers = Object.keys(firstRow);
  const find = (keywords: string[]): string | undefined =>
    headers.find((h) => {
      const low = h.toLowerCase();
      return keywords.some((k) => low.includes(k));
    });

  const description = find(["description", "item", "product", "particulars"]);
  const quantity = find(["qty", "quantity", "nos", "count"]);
  const unitRate = find(["rate", "price", "unit cost"]);
  const hsn = find(["hsn", "sac", "tariff"]);

  if (!description || !quantity) return null;
  return { description, quantity, unitRate, hsn };
}

/** Levenshtein-based similarity ∈ [0, 1]. 1.0 = identical. */
function similarity(a: string, b: string): number {
  const s1 = a.toLowerCase().trim();
  const s2 = b.toLowerCase().trim();
  if (!s1.length || !s2.length) return 0;
  if (s1 === s2) return 1;
  const maxLen = Math.max(s1.length, s2.length);
  const dist = levenshtein(s1, s2);
  return 1 - dist / maxLen;
}

function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const v0 = new Array<number>(n + 1);
  const v1 = new Array<number>(n + 1);
  for (let i = 0; i <= n; i++) v0[i] = i;
  for (let i = 0; i < m; i++) {
    v1[0] = i + 1;
    for (let j = 0; j < n; j++) {
      const cost = a[i] === b[j] ? 0 : 1;
      v1[j + 1] = Math.min(v1[j]! + 1, v0[j + 1]! + 1, v0[j]! + cost);
    }
    for (let j = 0; j <= n; j++) v0[j] = v1[j]!;
  }
  return v0[n]!;
}
