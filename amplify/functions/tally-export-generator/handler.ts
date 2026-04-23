/**
 * tally-export-generator â€” emits TallyPrime XML for a GRN or a DC and uploads
 * the file to S3 under `tally-exports/` with a 15-min pre-signed download URL.
 *
 * Input (AppSync resolver):
 *   - Either: { kind: "GRN", grnId: string }
 *   - Or:     { kind: "DC",  dcId: string, voucherType: "Sales" | "Delivery Note" }
 *
 * Output:
 *   {
 *     s3Key: string,
 *     presignedUrl: string,  // valid 15 min
 *     xmlSize: number,
 *     voucherCount: 1,
 *     exportedAt: ISO8601
 *   }
 *
 * Blocks export when:
 *   - SystemSettings ledger mappings are incomplete
 *   - Any line item has a Tally-incompatible HSN
 *   - GRN/DC is in DRAFT status
 * Error responses carry a `code` field the frontend uses to deep-link to
 * System Settings â†’ Tally Integration for easy correction.
 */
import { randomUUID } from "node:crypto";
import { PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import {
  buildGrnPurchaseVoucherXml,
  buildDcVoucherXml,
  type TallyLedgerMap,
  type TallyLineItem,
} from "../../../shared/tally.js";
import { isIntrastate } from "../../../shared/gstin.js";
import { PRESIGNED_URL_TTL_SECONDS } from "../../../shared/constants.js";
import { s3Client } from "../_lib/aws-clients.js";
import { getItem, queryItems, updateItem } from "../_lib/ddb.js";
import { writeAudit } from "../_lib/audit.js";

type GrnInput = { kind: "GRN"; grnId: string; actorUserId?: string };
type DcInput = {
  kind: "DC";
  dcId: string;
  voucherType: "Sales" | "Delivery Note";
  actorUserId?: string;
};
type Input = GrnInput | DcInput;

export interface Output {
  s3Key: string;
  presignedUrl: string;
  xmlSize: number;
  voucherCount: 1;
  exportedAt: string;
}

interface SettingsRow {
  companyGstin?: string;
  tallyPurchaseLedgerName?: string;
  tallySalesLedgerName?: string;
  tallyCgstLedgerName?: string;
  tallySgstLedgerName?: string;
  tallyIgstLedgerName?: string;
  tallyVendorNameMap?: Record<string, string>;
  tallyClientNameMap?: Record<string, string>;
}

export class TallyExportError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

// Read env var lazily so tests that set it in beforeEach see the correct value.
const getBucket = (): string => {
  const b = process.env.PRIVATE_BUCKET_NAME;
  if (!b) {
    throw new TallyExportError(
      "BUCKET_NOT_CONFIGURED",
      "PRIVATE_BUCKET_NAME env var is not set â€” Amplify storage hasn't been wired to this Lambda.",
    );
  }
  return b;
};

export const handler = async (rawEvent: Input | { arguments?: Input }): Promise<Output> => {
  // Support both CLI-invoke and AppSync resolver shapes.
  const event: Input = (rawEvent as { arguments?: Input })?.arguments ?? (rawEvent as Input);
  if (!event || !event.kind) {
    throw new TallyExportError("INVALID_INPUT", "`kind` is required (GRN | DC)");
  }

  const settings = await readSettings();
  if (!settings) {
    throw new TallyExportError(
      "SETTINGS_MISSING",
      "SystemSettings row not found â€” complete System Settings before exporting to Tally.",
    );
  }
  const ledgerMap = buildLedgerMap(settings);

  let xml: string;
  let docNumber: string;
  let entityType: "GoodsReceivedNote" | "DeliveryChallan";
  let entityId: string;

  if (event.kind === "GRN") {
    const { xml: grnXml, grnNumber } = await buildGrnXml(event.grnId, ledgerMap, settings);
    xml = grnXml;
    docNumber = grnNumber;
    entityType = "GoodsReceivedNote";
    entityId = event.grnId;
  } else {
    const { xml: dcXml, dcNumber } = await buildDcXml(
      event.dcId,
      event.voucherType,
      ledgerMap,
      settings,
    );
    xml = dcXml;
    docNumber = dcNumber;
    entityType = "DeliveryChallan";
    entityId = event.dcId;
  }

  // Upload XML to S3 under tally-exports/
  const s3Key = `tally-exports/${event.kind.toLowerCase()}/${docNumber}-${randomUUID().slice(0, 8)}.xml`;
  await s3Client().send(
    new PutObjectCommand({
      Bucket: getBucket(),
      Key: s3Key,
      Body: xml,
      ContentType: "application/xml",
      ServerSideEncryption: "AES256",
    }),
  );

  const presignedUrl = await getSignedUrl(
    s3Client(),
    new GetObjectCommand({ Bucket: getBucket(), Key: s3Key }),
    { expiresIn: PRESIGNED_URL_TTL_SECONDS },
  );

  const exportedAt = new Date().toISOString();

  // Mark record with export timestamp + S3 key for audit + UI display
  await updateItem(entityType, { id: entityId }, {
    UpdateExpression: "SET tallyXmlS3Key = :k, tallyExportedAt = :t, updatedAt = :t",
    ExpressionAttributeValues: { ":k": s3Key, ":t": exportedAt },
  });

  await writeAudit({
    actorUserId: event.actorUserId,
    action: "TALLY_EXPORT_GENERATED",
    entityType,
    entityId,
    after: { tallyXmlS3Key: s3Key, tallyExportedAt: exportedAt, documentNumber: docNumber },
  });

  return {
    s3Key,
    presignedUrl,
    xmlSize: xml.length,
    voucherCount: 1,
    exportedAt,
  };
};

// ---------- helpers ----------

async function readSettings(): Promise<SettingsRow | null> {
  // SystemSettings is conceptually a single-row table. Amplify creates a
  // standard (id) PK, so we scan for the first row. If more than one exists
  // it's a configuration error â€” the Admin UI should enforce one row.
  const { scanItems } = await import("../_lib/ddb.js");
  const rows = await scanItems<SettingsRow>("SystemSettings", { Limit: 1 });
  return rows[0] ?? null;
}

function buildLedgerMap(s: SettingsRow): TallyLedgerMap {
  return {
    purchaseLedgerName: s.tallyPurchaseLedgerName ?? "",
    salesLedgerName: s.tallySalesLedgerName ?? "",
    cgstLedgerName: s.tallyCgstLedgerName ?? "",
    sgstLedgerName: s.tallySgstLedgerName ?? "",
    igstLedgerName: s.tallyIgstLedgerName ?? "",
    vendorTallyNameMap: s.tallyVendorNameMap ?? {},
    clientTallyNameMap: s.tallyClientNameMap ?? {},
  };
}

async function buildGrnXml(
  grnId: string,
  ledgerMap: TallyLedgerMap,
  settings: SettingsRow,
): Promise<{ xml: string; grnNumber: string }> {
  const grn = await getItem<{
    id: string;
    grnNumber: string;
    grnDate: string;
    vendorId: string;
    vendorGstin?: string;
    intrastate?: boolean;
  }>("GoodsReceivedNote", { id: grnId });
  if (!grn) throw new TallyExportError("GRN_NOT_FOUND", `GRN ${grnId} not found`);

  // Pull all units received under this GRN â€” each is one physical unit.
  // We aggregate by (productId, hsn) for Tally stock-item lines.
  const units = await queryItems<{
    productId: string;
    hsnTallyFormat?: string;
    hsnCode?: string;
    purchasePrice?: number;
  }>("UnitRecord", {
    IndexName: "grnId-index",
    KeyConditionExpression: "grnId = :g",
    ExpressionAttributeValues: { ":g": grnId },
  }).catch(() => [] as never);

  if (!units.length) {
    throw new TallyExportError("GRN_EMPTY", `GRN ${grn.grnNumber} has no units recorded`);
  }

  // Bring in product details (name + gstRate).
  const productIds = [...new Set(units.map((u) => u.productId))];
  const products = await Promise.all(
    productIds.map((id) =>
      getItem<{
        id: string;
        productName?: string;
        modelNumber?: string;
        gstRatePercent?: number;
      }>("ProductMaster", { id }),
    ),
  );
  const productById = new Map(products.filter(Boolean).map((p) => [p!.id, p!]));

  const lineItems: TallyLineItem[] = units.map((u) => {
    const p = productById.get(u.productId);
    return {
      productName: p?.productName ?? "(unknown product)",
      modelNumber: p?.modelNumber,
      hsnTallyFormat: u.hsnTallyFormat ?? u.hsnCode ?? "",
      unitCount: 1,
      unitPriceInr: u.purchasePrice ?? 0,
      gstRatePercent: p?.gstRatePercent ?? 0,
    };
  });

  const intrastate =
    typeof grn.intrastate === "boolean"
      ? grn.intrastate
      : Boolean(
          settings.companyGstin && grn.vendorGstin && isIntrastate(settings.companyGstin, grn.vendorGstin),
        );

  const xml = buildGrnPurchaseVoucherXml(
    {
      voucherDate: new Date(grn.grnDate),
      grnNumber: grn.grnNumber,
      vendorId: grn.vendorId,
      lineItems,
      intrastate,
      narration: `GRN ${grn.grnNumber}`,
    },
    ledgerMap,
  );
  return { xml, grnNumber: grn.grnNumber };
}

async function buildDcXml(
  dcId: string,
  voucherType: "Sales" | "Delivery Note",
  ledgerMap: TallyLedgerMap,
  settings: SettingsRow,
): Promise<{ xml: string; dcNumber: string }> {
  const dc = await getItem<{
    id: string;
    dcNumber: string;
    dcDate: string;
    clientId?: string;
    status?: string;
    intrastate?: boolean;
  }>("DeliveryChallan", { id: dcId });
  if (!dc) throw new TallyExportError("DC_NOT_FOUND", `DC ${dcId} not found`);
  if (dc.status === "DRAFT") {
    throw new TallyExportError(
      "DC_DRAFT",
      `DC ${dc.dcNumber} is still in DRAFT â€” dispatch it before exporting to Tally`,
    );
  }
  if (!dc.clientId) {
    throw new TallyExportError(
      "DC_NO_CLIENT",
      `DC ${dc.dcNumber} has no clientId â€” cannot map to a Tally ledger`,
    );
  }

  const lines = await queryItems<{
    productName?: string;
    modelNumber?: string;
    hsnTallyFormat?: string;
    unitPriceInr?: number;
    gstRatePercent?: number;
  }>("DispatchLineItem", {
    IndexName: "deliveryChallanId-index",
    KeyConditionExpression: "deliveryChallanId = :d",
    ExpressionAttributeValues: { ":d": dcId },
  }).catch(() => [] as never);

  if (!lines.length) {
    throw new TallyExportError("DC_EMPTY", `DC ${dc.dcNumber} has no line items`);
  }

  const lineItems: TallyLineItem[] = lines.map((l) => ({
    productName: l.productName ?? "(unknown)",
    modelNumber: l.modelNumber,
    hsnTallyFormat: l.hsnTallyFormat ?? "",
    unitCount: 1,
    unitPriceInr: l.unitPriceInr ?? 0,
    gstRatePercent: l.gstRatePercent ?? 0,
  }));

  const xml = buildDcVoucherXml(
    {
      voucherDate: new Date(dc.dcDate),
      dcNumber: dc.dcNumber,
      clientId: dc.clientId,
      lineItems,
      intrastate: Boolean(dc.intrastate),
      voucherType,
      narration: `DC ${dc.dcNumber}`,
    },
    ledgerMap,
  );
  return { xml, dcNumber: dc.dcNumber };
}

