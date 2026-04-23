import { defineFunction } from "@aws-amplify/backend";

export const fyRollover = defineFunction({
  name: "fy-rollover",
  entry: "./handler.ts",
  runtime: 20,
  architecture: "arm64",
  timeoutSeconds: 300,
  memoryMB: 1024,
  environment: { APP_ENV: process.env.APP_ENV ?? "dev" },
});
