import { defineFunction } from "@aws-amplify/backend";

export const invoiceConfirmationScheduler = defineFunction({
  name: "invoice-confirmation-scheduler",
  entry: "./handler.ts",
  runtime: 20,
  architecture: "arm64",
  timeoutSeconds: 30,
  memoryMB: 512,
  environment: { APP_ENV: process.env.APP_ENV ?? "dev" },
});
