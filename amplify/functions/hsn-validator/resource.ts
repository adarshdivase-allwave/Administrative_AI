import { defineFunction } from "@aws-amplify/backend";

export const hsnValidator = defineFunction({
  name: "hsn-validator",
  entry: "./handler.ts",
  runtime: 20,
  architecture: "arm64",
  timeoutSeconds: 60,
  memoryMB: 512,
    environment: { APP_ENV: process.env.APP_ENV ?? "dev" },
});
