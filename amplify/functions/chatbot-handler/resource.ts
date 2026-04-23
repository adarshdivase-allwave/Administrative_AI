import { defineFunction } from "@aws-amplify/backend";

export const chatbotHandler = defineFunction({
  name: "chatbot-handler",
  entry: "./handler.ts",
  runtime: 20,
  architecture: "arm64",
  timeoutSeconds: 120,
  memoryMB: 1536,
    environment: { APP_ENV: process.env.APP_ENV ?? "dev" },
});
