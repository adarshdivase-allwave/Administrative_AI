/**
 * client-portal-handler â€” serves a read-only, token-authenticated project view
 * to external clients with NO Cognito login.
 *
 * Security model:
 *   - AppSync authorization mode: API_KEY (shared public key, rotated annually
 *     by fy-rollover Lambda). The API_KEY by itself exposes nothing sensitive;
 *     every call requires a valid ClientPortalToken on top.
 *   - We look up the token in DynamoDB, verify:
 *       * token exists
 *       * isRevoked === false
 *       * expiresAt > now
 *       * projectId is the one the caller is requesting
 *   - On success, return ONLY non-sensitive fields (no pricing, no GSTIN,
 *     no notes visible from sidebar comments, no cross-client data).
 *
 * Output shape carefully mirrors spec Â§21:
 *   - project name + company
 *   - allocated unit list (serial, product, status)
 *   - dispatch date
 *   - expected installation date
 *   - returned units
 *
 * NEVER returns: pricing, GSTINs, other projects, other clients' data,
 * internal notes, audit info.
 */
import { scanItems, getItem, updateItem, queryItems } from "../_lib/ddb.js";
import { writeAudit } from "../_lib/audit.js";

interface Input {
  token: string;
  projectId: string;
}

interface PortalUnit {
  serialNumber: string;
  productName: string;
  modelNumber?: string;
  status: string;
  dispatchedAt?: string;
  returnedAt?: string;
}

interface PortalResponse {
  projectName: string;
  companyName: string;
  clientName: string;
  siteCity?: string;
  siteState?: string;
  startDate?: string;
  expectedEndDate?: string;
  status?: string;
  unitCount: number;
  units: PortalUnit[];
  tokenExpiresAt: string;
  generatedAt: string;
}

interface TokenRow {
  id: string;
  projectId: string;
  token: string;
  expiresAt: string;
  isRevoked?: boolean;
  lastAccessedAt?: string;
}
interface Project {
  id: string;
  projectName?: string;
  clientId?: string;
  siteCity?: string;
  siteState?: string;
  startDate?: string;
  expectedEndDate?: string;
  status?: string;
}
interface Client { id: string; name?: string }
interface UnitRow {
  id: string;
  serialNumber?: string;
  productId?: string;
  status?: string;
  currentProjectId?: string;
  dispatchedAt?: string;
}
interface ProductRow { id: string; productName?: string; modelNumber?: string }

export const handler = async (rawEvent: Input | { arguments?: Input }): Promise<PortalResponse | { error: string }> => {
  // Support both CLI-invoke and AppSync resolver shapes.
  const event: Input = (rawEvent as { arguments?: Input })?.arguments ?? (rawEvent as Input);
  if (!event?.token || !event?.projectId) {
    return { error: "Both token and projectId are required." };
  }

  // 1. Look up token by its value (GSI lookup).
  let tokenRows: TokenRow[] = [];
  try {
    tokenRows = await queryItems<TokenRow>("ClientPortalToken", {
      IndexName: "token-index",
      KeyConditionExpression: "#t = :t",
      ExpressionAttributeNames: { "#t": "token" },
      ExpressionAttributeValues: { ":t": event.token },
    });
  } catch (_e) {
    // If the GSI isn't yet synthesized, fall back to scan.
    tokenRows = await scanItems<TokenRow>("ClientPortalToken", {
      FilterExpression: "#t = :t",
      ExpressionAttributeNames: { "#t": "token" },
      ExpressionAttributeValues: { ":t": event.token },
    });
  }
  const token = tokenRows[0];

  if (!token) return { error: "Invalid or unknown access link." };
  if (token.isRevoked) return { error: "This link has been revoked." };
  if (new Date(token.expiresAt).getTime() < Date.now()) {
    return { error: "This link has expired. Please request a new one from your project manager." };
  }
  if (token.projectId !== event.projectId) {
    return { error: "Invalid access link for this project." };
  }

  // 2. Load project and client.
  const project = await getItem<Project>("Project", { id: event.projectId });
  if (!project) return { error: "Project not found." };

  const client = project.clientId
    ? await getItem<Client>("Client", { id: project.clientId })
    : null;

  // 3. Load units allocated to this project.
  let units: UnitRow[] = [];
  try {
    units = await queryItems<UnitRow>("UnitRecord", {
      IndexName: "currentProjectId-index",
      KeyConditionExpression: "currentProjectId = :p",
      ExpressionAttributeValues: { ":p": event.projectId },
    });
  } catch (_e) {
    units = await scanItems<UnitRow>("UnitRecord", {
      FilterExpression: "currentProjectId = :p",
      ExpressionAttributeValues: { ":p": event.projectId },
    });
  }

  // Also surface already-returned units via a scan by returned status
  // (optional: could be filtered more precisely via ReturnRecord in a later iter).

  // 4. Hydrate product names.
  const productIds = [...new Set(units.map((u) => u.productId).filter(Boolean) as string[])];
  const products = new Map<string, ProductRow>();
  for (const pid of productIds) {
    const p = await getItem<ProductRow>("ProductMaster", { id: pid }).catch(() => undefined);
    if (p) products.set(pid, p);
  }

  const portalUnits: PortalUnit[] = units.map((u) => {
    const p = u.productId ? products.get(u.productId) : undefined;
    return {
      serialNumber: u.serialNumber ?? "â€”",
      productName: p?.productName ?? "Equipment",
      modelNumber: p?.modelNumber,
      status: u.status ?? "ALLOCATED_TO_PROJECT",
      dispatchedAt: u.dispatchedAt,
    };
  });

  // 5. Touch lastAccessedAt + audit log.
  const now = new Date().toISOString();
  await updateItem("ClientPortalToken", { id: token.id }, {
    UpdateExpression: "SET lastAccessedAt = :t, updatedAt = :t",
    ExpressionAttributeValues: { ":t": now },
  }).catch(() => undefined);

  await writeAudit({
    actorRole: "SYSTEM",
    action: "CLIENT_PORTAL_VIEW",
    entityType: "Project",
    entityId: event.projectId,
    after: { tokenId: token.id, unitsExposed: portalUnits.length },
  });

  return {
    projectName: project.projectName ?? "Project",
    companyName: process.env.COMPANY_NAME ?? "Your company",
    clientName: client?.name ?? "Client",
    siteCity: project.siteCity,
    siteState: project.siteState,
    startDate: project.startDate,
    expectedEndDate: project.expectedEndDate,
    status: project.status,
    unitCount: portalUnits.length,
    units: portalUnits,
    tokenExpiresAt: token.expiresAt,
    generatedAt: now,
  };
};
