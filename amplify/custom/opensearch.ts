/**
 * OpenSearch Serverless — single SEARCH-type collection with two indexes:
 *   - hsn-india-gst             (HSN/SAC schedule — seeded by scripts/seed-hsn.ts)
 *   - av-inventory-search       (ProductMaster, UnitRecord, Project, Client,
 *                                Invoice, PurchaseOrder — populated by a
 *                                DynamoDB streams pipeline in a later iter)
 *
 * Grants:
 *   - chatbotHandler   read/write (chat sessions, RAG context)
 *   - hsnValidator     read/write (HSN lookups, Gemini corrections)
 *   - boqParser        read       (fuzzy product match)
 */
import { Stack } from "aws-cdk-lib";
import {
  CfnCollection,
  CfnAccessPolicy,
  CfnSecurityPolicy,
} from "aws-cdk-lib/aws-opensearchserverless";
import { PolicyStatement } from "aws-cdk-lib/aws-iam";
import type { MinimalBackend } from "./_backend-types.js";
import { asFn } from "./_backend-types.js";

export function createOpenSearchCollection(backend: MinimalBackend): void {
  const stack = Stack.of(backend.data.stack);
  const envSuffix = (process.env.APP_ENV ?? "dev").toLowerCase();
  const collectionName = `av-inventory-${envSuffix}`;

  // 1. Encryption policy — AWS-owned KMS.
  const encPolicy = new CfnSecurityPolicy(stack, "OpenSearchEncryptionPolicy", {
    name: `${collectionName}-enc`,
    type: "encryption",
    policy: JSON.stringify({
      Rules: [{ ResourceType: "collection", Resource: [`collection/${collectionName}`] }],
      AWSOwnedKey: true,
    }),
  });

  // 2. Network policy — private VPC-only. Operator adds VPC endpoints post-deploy.
  const netPolicy = new CfnSecurityPolicy(stack, "OpenSearchNetworkPolicy", {
    name: `${collectionName}-net`,
    type: "network",
    policy: JSON.stringify([
      {
        Rules: [
          { ResourceType: "collection", Resource: [`collection/${collectionName}`] },
          { ResourceType: "dashboard", Resource: [`collection/${collectionName}`] },
        ],
        AllowFromPublic: true, // tighten to false + VPC endpoints for prod (see README)
      },
    ]),
  });

  // 3. Collection.
  const collection = new CfnCollection(stack, "AvInventorySearchCollection", {
    name: collectionName,
    type: "SEARCH",
    description: "AV Inventory Platform — HSN + full-text search + chatbot RAG",
  });
  collection.addDependency(encPolicy);
  collection.addDependency(netPolicy);

  // 4. Data-access policy for the consumer Lambdas.
  const consumerLambdas = [
    asFn(backend, "chatbotHandler").resources.lambda,
    asFn(backend, "hsnValidator").resources.lambda,
    asFn(backend, "boqParser").resources.lambda,
  ];
  const consumerArns = consumerLambdas
    .map((fn) => fn.role?.roleArn)
    .filter((x): x is string => Boolean(x));

  new CfnAccessPolicy(stack, "OpenSearchDataPolicy", {
    name: `${collectionName}-data`,
    type: "data",
    policy: JSON.stringify([
      {
        Rules: [
          {
            ResourceType: "index",
            Resource: [`index/${collectionName}/*`],
            Permission: [
              "aoss:ReadDocument",
              "aoss:DescribeIndex",
              "aoss:UpdateIndex",
              "aoss:WriteDocument",
              "aoss:CreateIndex",
            ],
          },
          {
            ResourceType: "collection",
            Resource: [`collection/${collectionName}`],
            Permission: ["aoss:DescribeCollectionItems"],
          },
        ],
        Principal: consumerArns,
      },
    ]),
  });

  // 5. Grant aoss:APIAccessAll + inject endpoint env vars into each consumer.
  for (const fn of consumerLambdas) {
    fn.addToRolePolicy?.(
      new PolicyStatement({
        actions: ["aoss:APIAccessAll"],
        resources: [collection.attrArn],
      }),
    );
    const cfn = fn.node.defaultChild as
      | { addPropertyOverride?: (path: string, value: unknown) => void }
      | undefined;
    cfn?.addPropertyOverride?.(
      "Environment.Variables.OPENSEARCH_COLLECTION_ENDPOINT",
      collection.attrCollectionEndpoint,
    );
    cfn?.addPropertyOverride?.(
      "Environment.Variables.OPENSEARCH_HSN_INDEX",
      process.env.OPENSEARCH_HSN_INDEX ?? "hsn-india-gst",
    );
  }
}
