import { test, expect } from "@playwright/test";

/**
 * Client portal — public, no Cognito. Token validation happens server-side.
 *
 * In mock mode, the mock Amplify client returns a project only when
 * token=valid-mock-token.
 */
test.describe("Client portal (public)", () => {
  test("invalid token shows polite error", async ({ page }) => {
    await page.goto("/portal/some-project?t=bogus-token");
    // `.first()` because the heading + helper text both match the regex.
    await expect(
      page.getByText(/Can't open this portal|Invalid or unknown/i).first(),
    ).toBeVisible({ timeout: 10_000 });
  });

  test("missing token gets helpful message", async ({ page }) => {
    await page.goto("/portal/some-project");
    await expect(page.getByText(/link is incomplete/i)).toBeVisible();
  });

  test("valid token renders project equipment list", async ({ page }) => {
    await page.goto("/portal/mock-project?t=valid-mock-token");
    // Project name from the mock
    await expect(page.getByRole("heading", { name: /Mock Project/i })).toBeVisible({
      timeout: 10_000,
    });
    // Equipment table present
    await expect(page.getByText(/Equipment allocated to this project/i)).toBeVisible();
    // At least one serial number
    await expect(page.getByText(/SN-MOCK-/).first()).toBeVisible();
    // NO pricing is exposed on the portal
    await expect(page.getByText(/₹|INR/i)).not.toBeVisible();
  });

  test("portal footer reminds user link is view-only", async ({ page }) => {
    await page.goto("/portal/mock-project?t=valid-mock-token");
    await expect(page.getByText(/secure link/i)).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(/do not forward/i)).toBeVisible();
  });
});
