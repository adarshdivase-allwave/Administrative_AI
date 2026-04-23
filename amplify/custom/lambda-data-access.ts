/**
 * Grants all business Lambdas DynamoDB access WITHOUT creating CloudFormation
 * cross-stack references from function stack → data stack.
 *
 * Background:
 *   Amplify Gen 2 splits the backend into independent nested stacks (data,
 *   function, auth, storage, ...). The data stack references function-stack
 *   Lambda ARNs for AppSync custom operations (one-way dep: data → function).
 *   If we ALSO reference data-stack table ARNs/names from function-stack
 *   Lambdas (for IAM grants or env vars), CloudFormation sees a cycle and
 *   refuses to deploy with `CloudformationStackCircularDependencyError`.
 *
 *   Moving Lambdas into the data stack (`resourceGroupName: "data"`) works
 *   for small numbers but blows CloudFormation's 1 MB template size limit
 *   once you have 30+ AppSync models, each with their own resolver pipelines.
 *
 * Solution:
 *   - IAM: grant each Lambda wildcard access to `table/*` in the current
 *     region+account. Scope stays account-local. No specific-table ARN ref
 *     means no cross-stack import.
 *   - Table-name discovery: set an env flag and let `_lib/ddb.ts` resolve
 *     real table names at Lambda runtime via `ListTables` + prefix match
 *     (cached per cold start).
 *   - Secrets Manager, SES, and SSM grants stay as they were (already scoped
 *     via Secret/SES ARNs that don't live in the data stack).
 */
import { Stack } from "aws-cdk-lib";
import { PolicyStatement } from "aws-cdk-lib/aws-iam";
import type { MinimalBackend } from "./_backend-types.js";
import { asFn } from "./_backend-types.js";

const LAMBDA_KEYS = [
  "alertEngine",
  "reminderDispatcher",
  "invoiceScheduler",
  "paymentReminderSender",
  "msmeComplianceChecker",
  "invoiceConfirmationScheduler",
  "dailyDigest",
  "depreciationEngine",
  "hsnValidator",
  "boqParser",
  "chatbotHandler",
  "tallyExportGenerator",
  "forexRateFetcher",
  "fyRollover",
  "tdsAutoCreator",
  "warrantyAlertMonthly",
  "amcRenewalChecker",
  "userAdmin",
  "clientPortalHandler",
] as const;

interface LambdaTarget {
  addToRolePolicy?: (s: PolicyStatement) => void;
  node: { defaultChild?: unknown };
}

export function wireLambdaDataAccess(backend: MinimalBackend): void {
  console.log(`[lambda-data-access] Wiring ${LAMBDA_KEYS.length} Lambdas (wildcard + runtime discovery).`);

  for (const key of LAMBDA_KEYS) {
    let fnResource;
    try {
      fnResource = asFn(backend, key);
    } catch {
      continue;
    }
    const lambdaFn = fnResource.resources.lambda as LambdaTarget;
    const stack = Stack.of(lambdaFn as unknown as import("constructs").IConstruct);

    // Wildcard table ARN → no cross-stack reference, no circular dependency.
    const wildcardTableArn = stack.formatArn({
      service: "dynamodb",
      resource: "table",
      resourceName: "*",
    });

    lambdaFn.addToRolePolicy?.(
      new PolicyStatement({
        actions: [
          "dynamodb:GetItem",
          "dynamodb:Query",
          "dynamodb:Scan",
          "dynamodb:PutItem",
          "dynamodb:UpdateItem",
          "dynamodb:DeleteItem",
          "dynamodb:BatchGetItem",
          "dynamodb:BatchWriteItem",
          "dynamodb:ConditionCheckItem",
          "dynamodb:DescribeTable",
          "dynamodb:ListTables",
        ],
        resources: [wildcardTableArn, `${wildcardTableArn}/index/*`],
      }),
    );

    const cfn = lambdaFn.node.defaultChild as
      | { addPropertyOverride?: (path: string, value: unknown) => void }
      | undefined;
    cfn?.addPropertyOverride?.("Environment.Variables.AMPLIFY_DATA_RUNTIME_DISCOVERY", "1");
  }
}
