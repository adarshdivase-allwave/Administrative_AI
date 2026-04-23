import { test, expect } from "@playwright/test";

/**
 * Auth-shell smoke test.
 *
 * In mock mode, Cognito isn't wired, so we only verify that:
 *   - Unauthenticated users land on /sign-in
 *   - The sign-in UI renders with required controls
 *
 * In live mode, add: actual sign-in with E2E_TEST_USER_EMAIL + password,
 * then assert redirect to the dashboard.
 */
test.describe("Authentication shell", () => {
  test("unauthenticated user is redirected to sign-in", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveURL(/sign-in/);
    await expect(page.getByRole("heading", { name: /sign in/i })).toBeVisible();
    await expect(page.getByLabel("Email")).toBeVisible();
    await expect(page.getByLabel("Password")).toBeVisible();
  });

  test("forgot-password link goes to reset page", async ({ page }) => {
    await page.goto("/sign-in");
    await page.getByRole("link", { name: /forgot password/i }).click();
    await expect(page).toHaveURL(/forgot-password/);
    await expect(page.getByRole("heading", { name: /reset password/i })).toBeVisible();
  });

  test("403 page renders without crashing", async ({ page }) => {
    await page.goto("/403");
    await expect(page.getByText(/don't have access/i)).toBeVisible();
  });
});
