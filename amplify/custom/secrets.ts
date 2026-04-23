/**
 * Secrets Manager references.
 *
 * We do NOT create secrets from code (that would leak values into CloudFormation).
 * Operators create them manually:
 *
 *   aws secretsmanager create-secret \
 *     --name av-inventory/gemini-api-key \
 *     --secret-string '{"apiKey":"..."}'
 *
 * This module only GRANTS the listed Lambdas `secretsmanager:GetSecretValue`
 * on the specific ARNs.
 */
import { Stack } from "aws-cdk-lib";
import { Secret } from "aws-cdk-lib/aws-secretsmanager";
import { PolicyStatement } from "aws-cdk-lib/aws-iam";
import type { MinimalBackend } from "./_backend-types.js";
import { asFn } from "./_backend-types.js";

const GEMINI_SECRET_ID = process.env.SECRET_ID_GEMINI ?? "av-inventory/gemini-api-key";
const EXCHANGE_SECRET_ID =
  process.env.SECRET_ID_EXCHANGE_RATE ?? "av-inventory/exchangerate-api-key";

export function createSecretReferences(backend: MinimalBackend): void {
  const stack = Stack.of(backend.data.stack);

  const gemini = Secret.fromSecretNameV2(stack, "GeminiApiKey", GEMINI_SECRET_ID);
  const exchange = Secret.fromSecretNameV2(stack, "ExchangeRateApiKey", EXCHANGE_SECRET_ID);

  const chatbot = asFn(backend, "chatbotHandler").resources.lambda;
  const hsn = asFn(backend, "hsnValidator").resources.lambda;
  const forex = asFn(backend, "forexRateFetcher").resources.lambda;

  grantRead(chatbot, gemini.secretArn);
  grantRead(hsn, gemini.secretArn);
  grantRead(forex, exchange.secretArn);

  addEnv(chatbot, "GEMINI_SECRET_ID", GEMINI_SECRET_ID);
  addEnv(hsn, "GEMINI_SECRET_ID", GEMINI_SECRET_ID);
  addEnv(forex, "EXCHANGE_RATE_SECRET_ID", EXCHANGE_SECRET_ID);
}

function grantRead(fn: { addToRolePolicy?: (s: PolicyStatement) => void }, secretArn: string): void {
  fn.addToRolePolicy?.(
    new PolicyStatement({
      actions: ["secretsmanager:GetSecretValue"],
      resources: [secretArn, `${secretArn}-*`],
    }),
  );
}

function addEnv(fn: { node: { defaultChild?: unknown } }, key: string, value: string): void {
  const cfn = fn.node.defaultChild as
    | { addPropertyOverride?: (path: string, value: unknown) => void }
    | undefined;
  cfn?.addPropertyOverride?.(`Environment.Variables.${key}`, value);
}
