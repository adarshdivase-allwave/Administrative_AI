/**
 * AuditLog writer — append-only. All Lambdas that mutate state should call
 * this so the audit trail is consistent. Never use DeleteItem on AuditLog
 * (the IAM policy on the data schema explicitly disallows it).
 */
import { randomUUID } from "node:crypto";
import { putItem } from "./ddb.js";

export interface AuditEntry {
  actorUserId?: string;
  actorRole?: "Admin" | "Logistics" | "Purchase" | "Sales" | "SYSTEM";
  action: string;
  entityType: string;
  entityId?: string;
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
  ip?: string;
  userAgent?: string;
}

export async function writeAudit(entry: AuditEntry): Promise<void> {
  const now = new Date().toISOString();
  await putItem("AuditLog", {
    id: randomUUID(),
    actorUserId: entry.actorUserId,
    actorRole: entry.actorRole ?? "SYSTEM",
    action: entry.action,
    entityType: entry.entityType,
    entityId: entry.entityId,
    before: entry.before,
    after: entry.after,
    ip: entry.ip,
    userAgent: entry.userAgent,
    occurredAt: now,
    createdAt: now,
    updatedAt: now,
  });
}
