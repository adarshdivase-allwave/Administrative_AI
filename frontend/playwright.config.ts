import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright E2E config.
 *
 * Two run modes:
 *
 *   1. `npm run test:e2e:mock` — spins up Vite with VITE_E2E_MOCK=1. The
 *      Amplify client is swapped for a deterministic in-memory mock (see
 *      `src/lib/amplify-client.mock.ts`). Zero AWS dependency. Fast.
 *      This is the default CI path.
 *
 *   2. `npm run test:e2e:live` — runs against a real Amplify sandbox.
 *      Needs an `amplify_outputs.json` at repo root and the env var
 *      `E2E_TEST_USER_EMAIL` + `E2E_TEST_USER_PASSWORD` pointing at a
 *      pre-seeded Cognito user with Admin group.
 *
 * Both modes use the same specs — only the base URL and env vars change.
 */

const mockMode = process.env.E2E_MODE !== "live";

export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  expect: { timeout: 5_000 },
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : [["list"]],

  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:5173",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },

  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],

  webServer: mockMode
    ? {
        command: "npm run dev:mock",
        port: 5173,
        reuseExistingServer: !process.env.CI,
        timeout: 60_000,
        env: { VITE_E2E_MOCK: "1" },
      }
    : undefined,
});
