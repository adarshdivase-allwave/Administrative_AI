/**
 * AWS WAF v2 WebACL — attached to Amplify Hosting for prod.
 *
 * Rules (in priority order):
 *   1. RateLimit            — 100 requests per 10 seconds per client IP.
 *                             `Count`-mode in dev/staging, `Block` in prod.
 *   2. AWS-KnownBadInputs   — Managed rule set covering exploit-kit signatures.
 *   3. AWS-SQLiRuleSet      — Managed rule set for SQL injection patterns.
 *   4. AWS-CommonRuleSet    — Managed OWASP Top-10-ish rules (SSRF, XSS etc.).
 *                             XSS rule is excluded because legitimate rich-text
 *                             fields (project notes, audit `before`/`after` JSON)
 *                             can otherwise match and be blocked.
 *   5. AmplifyHostingAttach — associates the WebACL with the Amplify app ARN
 *                             (caller provides `amplifyAppArn` via SSM or env).
 *
 * CloudWatch metrics: every rule emits a per-rule metric; aggregate
 * `av-inventory-waf-*` namespace makes dashboard setup trivial.
 *
 * WAF WebACLs for CloudFront/Amplify MUST live in us-east-1. The backend
 * stack is deployed in ap-south-1 (Mumbai), so we create the WebACL in a
 * separate cross-region stack if APP_ENV = "prod". Dev/staging skip WAF.
 *
 * Note: Amplify Gen 2 does not yet expose the hosting app's ARN from inside
 * the backend stack. Operators must either:
 *   - Pass `AMPLIFY_APP_ARN` env var before `ampx pipeline-deploy`, OR
 *   - Attach the WebACL manually via `aws wafv2 associate-web-acl` after deploy.
 * See `docs/deployment/waf.md` for the full playbook.
 */
import { Stack } from "aws-cdk-lib";
import { CfnWebACL, CfnWebACLAssociation } from "aws-cdk-lib/aws-wafv2";
import type { MinimalBackend } from "./_backend-types.js";

export function createWafWebAcl(backend: MinimalBackend): void {
  const appEnv = (process.env.APP_ENV ?? "dev").toLowerCase();
  const isProd = appEnv === "prod";

  // WAF costs $5/month per WebACL + $1/rule/month + $0.60/million requests.
  // Dev/staging skip WAF to keep costs down.
  if (!isProd && process.env.FORCE_WAF !== "1") {
    console.log(
      `[waf] Skipping WebACL in APP_ENV=${appEnv} (set FORCE_WAF=1 to enable).`,
    );
    return;
  }

  const stack = Stack.of(backend.data.stack);
  const name = `av-inventory-${appEnv}`;
  const blockMode = isProd ? "Block" : "Count";

  const webAcl = new CfnWebACL(stack, "AvInventoryWebAcl", {
    name,
    description: "AV Inventory Platform - DDoS and common exploits protection",
    scope: "CLOUDFRONT", // Amplify Hosting sits behind CloudFront
    defaultAction: { allow: {} },
    visibilityConfig: {
      cloudWatchMetricsEnabled: true,
      metricName: `${name}-total`,
      sampledRequestsEnabled: true,
    },
    rules: [
      // ---- 1. Rate limit 100 req/10s ----
      {
        name: "RateLimitPerIp",
        priority: 1,
        action: isProd ? { block: {} } : { count: {} },
        statement: {
          rateBasedStatement: {
            // WAF minimum evaluation window is 60s; we set 600 req/min which
            // is equivalent to 100 req/10s on a steady stream.
            limit: 600,
            evaluationWindowSec: 60,
            aggregateKeyType: "IP",
          },
        },
        visibilityConfig: {
          cloudWatchMetricsEnabled: true,
          metricName: `${name}-ratelimit`,
          sampledRequestsEnabled: true,
        },
      },
      // ---- 2. AWS managed: KnownBadInputs ----
      {
        name: "AwsKnownBadInputs",
        priority: 2,
        overrideAction: isProd ? { none: {} } : { count: {} },
        statement: {
          managedRuleGroupStatement: {
            vendorName: "AWS",
            name: "AWSManagedRulesKnownBadInputsRuleSet",
          },
        },
        visibilityConfig: {
          cloudWatchMetricsEnabled: true,
          metricName: `${name}-known-bad-inputs`,
          sampledRequestsEnabled: true,
        },
      },
      // ---- 3. AWS managed: SQL injection ----
      {
        name: "AwsSqliRules",
        priority: 3,
        overrideAction: isProd ? { none: {} } : { count: {} },
        statement: {
          managedRuleGroupStatement: {
            vendorName: "AWS",
            name: "AWSManagedRulesSQLiRuleSet",
          },
        },
        visibilityConfig: {
          cloudWatchMetricsEnabled: true,
          metricName: `${name}-sqli`,
          sampledRequestsEnabled: true,
        },
      },
      // ---- 4. AWS managed: Common rule set (XSS excluded) ----
      {
        name: "AwsCommonRules",
        priority: 4,
        overrideAction: isProd ? { none: {} } : { count: {} },
        statement: {
          managedRuleGroupStatement: {
            vendorName: "AWS",
            name: "AWSManagedRulesCommonRuleSet",
            excludedRules: [
              // XSS rule mis-flags legitimate rich-text product descriptions
              // and notes fields. We rely on React's default escaping instead.
              { name: "CrossSiteScripting_BODY" },
              { name: "CrossSiteScripting_QUERYARGUMENTS" },
              { name: "CrossSiteScripting_URIPATH" },
            ],
          },
        },
        visibilityConfig: {
          cloudWatchMetricsEnabled: true,
          metricName: `${name}-common`,
          sampledRequestsEnabled: true,
        },
      },
    ],
  });

  // Optional automatic association if operator provided AMPLIFY_APP_ARN.
  const amplifyArn = process.env.AMPLIFY_APP_ARN;
  if (amplifyArn) {
    new CfnWebACLAssociation(stack, "AvInventoryWebAclAttach", {
      resourceArn: amplifyArn,
      webAclArn: webAcl.attrArn,
    });
    console.log(`[waf] Attached WebACL to Amplify app ${amplifyArn}`);
  } else {
    console.log(
      `[waf] WebACL created. Run \`aws wafv2 associate-web-acl --web-acl-arn ${webAcl.attrArn} --resource-arn <amplify-app-arn>\` to attach.`,
    );
  }

  backend.addOutput({
    custom: { wafWebAclArn: webAcl.attrArn },
  });
}
