/**
 * AV Inventory Platform — Amplify Gen 2 backend entry.
 *
 * Wires together: Cognito auth, AppSync + DynamoDB data (36 tables),
 * S3 storage (2 buckets), 17 Lambda functions, EventBridge schedules,
 * Secrets Manager references, SES templates, OpenSearch Serverless.
 *
 * Every DynamoDB table is hardened (PITR + SSE + deletion protection)
 * via the post-synth override in `amplify/custom/dynamo-hardening.ts`.
 */
import { defineBackend } from "@aws-amplify/backend";

import { auth } from "./auth/resource.js";
import { data } from "./data/resource.js";
import { storagePrivate, storageEmailAssets } from "./storage/resource.js";

import { alertEngine } from "./functions/alert-engine/resource.js";
import { reminderDispatcher } from "./functions/reminder-dispatcher/resource.js";
import { invoiceScheduler } from "./functions/invoice-scheduler/resource.js";
import { paymentReminderSender } from "./functions/payment-reminder-sender/resource.js";
import { msmeComplianceChecker } from "./functions/msme-compliance-checker/resource.js";
import { invoiceConfirmationScheduler } from "./functions/invoice-confirmation-scheduler/resource.js";
import { dailyDigest } from "./functions/daily-digest/resource.js";
import { depreciationEngine } from "./functions/depreciation-engine/resource.js";
import { hsnValidator } from "./functions/hsn-validator/resource.js";
import { boqParser } from "./functions/boq-parser/resource.js";
import { chatbotHandler } from "./functions/chatbot-handler/resource.js";
import { tallyExportGenerator } from "./functions/tally-export-generator/resource.js";
import { forexRateFetcher } from "./functions/forex-rate-fetcher/resource.js";
import { fyRollover } from "./functions/fy-rollover/resource.js";
import { tdsAutoCreator } from "./functions/tds-auto-creator/resource.js";
import { warrantyAlertMonthly } from "./functions/warranty-alert-monthly/resource.js";
import { amcRenewalChecker } from "./functions/amc-renewal-checker/resource.js";
import { userAdmin } from "./functions/user-admin/resource.js";
import { clientPortalHandler } from "./functions/client-portal-handler/resource.js";

import { applyDynamoHardening } from "./custom/dynamo-hardening.js";
import { createEventBridgeSchedules } from "./custom/eventbridge-schedules.js";
import { createSesTemplates } from "./custom/ses-templates.js";
import { createSecretReferences } from "./custom/secrets.js";
import { createOpenSearchCollection } from "./custom/opensearch.js";
import { createWafWebAcl } from "./custom/waf.js";
import { wireLambdaDataAccess } from "./custom/lambda-data-access.js";
import type { MinimalBackend } from "./custom/_backend-types.js";
import { PolicyStatement } from "aws-cdk-lib/aws-iam";

const backend = defineBackend({
  auth,
  data,
  storagePrivate,
  storageEmailAssets,
  alertEngine,
  reminderDispatcher,
  invoiceScheduler,
  paymentReminderSender,
  msmeComplianceChecker,
  invoiceConfirmationScheduler,
  dailyDigest,
  depreciationEngine,
  hsnValidator,
  boqParser,
  chatbotHandler,
  tallyExportGenerator,
  forexRateFetcher,
  fyRollover,
  tdsAutoCreator,
  warrantyAlertMonthly,
  amcRenewalChecker,
  userAdmin,
  clientPortalHandler,
});

// ---- Post-synth hardening + custom infra ----
// `backend` is typed as a rich generic from defineBackend; we widen it to
// our minimal structural interface for the custom-construct helpers.
const b = backend as unknown as MinimalBackend;

applyDynamoHardening(b);
wireLambdaDataAccess(b); // grant Lambdas DynamoDB IAM + inject table-name env vars
createEventBridgeSchedules(b);
createSesTemplates(b);
createSecretReferences(b);

// OpenSearch Serverless is expensive (~$180/mo idle for min 4 OCUs).
// It's OFF by default — HSN lookup uses DynamoDB (seed via seed-hsn.ts)
// and chatbot RAG uses keyword DynamoDB scans + Gemini's 1M-token context.
// Set USE_OPENSEARCH=1 in your deploy env to enable the premium path.
if (process.env.USE_OPENSEARCH === "1") {
  createOpenSearchCollection(b);
}

createWafWebAcl(b);

// Grant the user-admin Lambda Cognito admin permissions scoped to THIS user
// pool only, and inject the pool ID so the handler knows which pool to hit.
// Amplify Gen 2 doesn't auto-grant Cognito admin rights, so we add the
// IAM statement post-synth.
{
  const cognitoPoolArn = (backend.auth.resources.userPool as { userPoolArn: string }).userPoolArn;
  const cognitoPoolId = (backend.auth.resources.userPool as { userPoolId: string }).userPoolId;
  const lambda = (backend.userAdmin.resources as { lambda: {
    addToRolePolicy?: (stmt: unknown) => void;
    node: { defaultChild?: { addPropertyOverride?: (path: string, value: unknown) => void } };
  }}).lambda;

  // Env var so the handler can call `userPoolId()`.
  lambda.node.defaultChild?.addPropertyOverride?.(
    "Environment.Variables.AMPLIFY_AUTH_USERPOOL_ID",
    cognitoPoolId,
  );

  // IAM: allow all cognito-idp admin actions on exactly this pool.
  lambda.addToRolePolicy?.(
    new PolicyStatement({
      actions: [
        "cognito-idp:ListUsers",
        "cognito-idp:AdminCreateUser",
        "cognito-idp:AdminAddUserToGroup",
        "cognito-idp:AdminRemoveUserFromGroup",
        "cognito-idp:AdminListGroupsForUser",
        "cognito-idp:AdminResetUserPassword",
        "cognito-idp:AdminDisableUser",
        "cognito-idp:AdminEnableUser",
        "cognito-idp:AdminDeleteUser",
      ],
      resources: [cognitoPoolArn],
    }),
  );
}

backend.addOutput({
  custom: {
    appEnv: process.env.APP_ENV ?? "dev",
  },
});

export default backend;
