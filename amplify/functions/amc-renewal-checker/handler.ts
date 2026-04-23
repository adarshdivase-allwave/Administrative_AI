/**
 * amc-renewal-checker — daily @ 10:30 IST.
 *
 * Flags AMC contracts expiring in the next 45 days. Creates StockAlert rows
 * and sends an email to Admin with renewal suggestions (with option to
 * auto-create a renewal PO in a future iteration).
 */
import type { ScheduledHandler } from "aws-lambda";
import { scanItems, putItem, updateItem } from "../_lib/ddb.js";
import { sendTemplatedEmail } from "../_lib/ses.js";
import { writeAudit } from "../_lib/audit.js";
import { daysBetween, formatIST } from "../../../shared/fy.js";
import { randomUUID } from "node:crypto";

interface AmcRow {
  id: string;
  contractNumber?: string;
  endDate?: string;
  status?: string;
  renewalReminderSentAt?: string;
}

export const handler: ScheduledHandler = async () => {
  const today = new Date();
  const amcs = await scanItems<AmcRow>("AMCContract", {
    FilterExpression: "#s = :s",
    ExpressionAttributeNames: { "#s": "status" },
    ExpressionAttributeValues: { ":s": "ACTIVE" },
  });

  let alerted = 0;
  for (const a of amcs) {
    if (!a.endDate) continue;
    const days = daysBetween(today, new Date(a.endDate));
    if (days > 45 || days < 0) continue;

    const now = new Date().toISOString();
    await putItem("StockAlert", {
      id: `AMC_EXPIRING_45#${today.toISOString().slice(0, 10)}#${a.id}`,
      alertType: "AMC_EXPIRING_45",
      severity: "WARNING",
      message: `AMC ${a.contractNumber ?? a.id} expires in ${days} days (${formatIST(new Date(a.endDate))})`,
      generatedAt: now,
      isActive: "TRUE",
      createdAt: now,
      updatedAt: now,
    }).catch((e) => {
      // ConditionalCheckFailed on duplicate — fine.
      if ((e as { name?: string }).name !== "ConditionalCheckFailedException") throw e;
    });

    // Bump the reminder timestamp so the next day's run can notice this one's
    // already been flagged. (Stamp only; real notification debounce logic
    // would live in the Reminder/SES email layer.)
    await updateItem("AMCContract", { id: a.id }, {
      UpdateExpression: "SET renewalReminderSentAt = :t, updatedAt = :t",
      ExpressionAttributeValues: { ":t": now },
    });

    alerted++;
  }

  if (alerted > 0) {
    const recipients = (process.env.DIGEST_ADMIN_EMAILS ?? "").split(",").filter(Boolean);
    if (recipients.length > 0) {
      try {
        await sendTemplatedEmail({
          to: recipients,
          templateName: "ALERT_AMC_EXPIRING",
          templateData: {
            count: alerted,
            digestDate: formatIST(today),
          },
        });
      } catch (e) {
        console.warn("[amc-renewal-checker] SES send failed:", (e as Error).message);
      }
    }
  }

  await writeAudit({
    actorRole: "SYSTEM",
    action: "AMC_RENEWAL_SCAN",
    entityType: "AMCScanRun",
    entityId: `amc-${today.toISOString().slice(0, 10)}-${randomUUID().slice(0, 6)}`,
    after: { totalActive: amcs.length, alerted },
  });

  console.info(`[amc-renewal-checker] done: scanned=${amcs.length} alerted=${alerted}`);
};
