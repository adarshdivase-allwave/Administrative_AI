/**
 * Typed access to `import.meta.env.VITE_*` values. Keeps magic strings out
 * of components and makes it easier to typo-proof env-var consumption.
 */
export const env = {
  appEnv: (import.meta.env.VITE_APP_ENV ?? "dev") as "dev" | "staging" | "prod",
  companyName: import.meta.env.VITE_COMPANY_NAME ?? "AV Inventory",
  companyLogoUrl: import.meta.env.VITE_COMPANY_LOGO_URL ?? "",
  chatbotEnabled: (import.meta.env.VITE_CHATBOT_ENABLED ?? "true") === "true",
  sessionWarningMinutes: Number(import.meta.env.VITE_SESSION_WARNING_MINUTES ?? 5),
  awsRegion: import.meta.env.VITE_AWS_REGION ?? "ap-south-1",
};
