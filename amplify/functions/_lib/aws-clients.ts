/**
 * Shared AWS SDK client factories for Lambda handlers.
 *
 * Design rules:
 *   - Lazy singletons: clients are created on first use inside a warm Lambda
 *     container and reused for the lifetime of that container.
 *   - Region always read from `AWS_REGION` (set by Lambda runtime).
 *   - All clients support the `aws-sdk-client-mock` pattern for unit testing.
 *   - No credentials passed explicitly — Lambda IAM role takes over.
 */
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { SESv2Client } from "@aws-sdk/client-sesv2";
import { S3Client } from "@aws-sdk/client-s3";
import { SecretsManagerClient } from "@aws-sdk/client-secrets-manager";
import { SchedulerClient } from "@aws-sdk/client-scheduler";
import { SNSClient } from "@aws-sdk/client-sns";

let _ddb: DynamoDBDocumentClient | undefined;
let _ses: SESv2Client | undefined;
let _s3: S3Client | undefined;
let _secrets: SecretsManagerClient | undefined;
let _scheduler: SchedulerClient | undefined;
let _sns: SNSClient | undefined;

const REGION = process.env.AWS_REGION ?? "ap-south-1";

export function ddbClient(): DynamoDBDocumentClient {
  if (!_ddb) {
    const raw = new DynamoDBClient({ region: REGION });
    _ddb = DynamoDBDocumentClient.from(raw, {
      marshallOptions: {
        removeUndefinedValues: true,
        convertClassInstanceToMap: true,
      },
    });
  }
  return _ddb;
}

export function sesClient(): SESv2Client {
  _ses ??= new SESv2Client({ region: REGION });
  return _ses;
}

export function s3Client(): S3Client {
  _s3 ??= new S3Client({ region: REGION });
  return _s3;
}

export function secretsClient(): SecretsManagerClient {
  _secrets ??= new SecretsManagerClient({ region: REGION });
  return _secrets;
}

export function schedulerClient(): SchedulerClient {
  _scheduler ??= new SchedulerClient({ region: REGION });
  return _scheduler;
}

export function snsClient(): SNSClient {
  _sns ??= new SNSClient({ region: REGION });
  return _sns;
}

/**
 * Test-only reset. Invoked from aws-sdk-client-mock `beforeEach` to drop
 * the cached clients so mocks are picked up on next call.
 */
export function _resetClientsForTests(): void {
  _ddb = undefined;
  _ses = undefined;
  _s3 = undefined;
  _secrets = undefined;
  _scheduler = undefined;
  _sns = undefined;
}
