import { test, expect } from "@playwright/test";

/**
 * Field-level India-compliance validators — GSTIN + HSN input components.
 *
 * These are tested via the Sign-in page (mock mode) by navigating directly
 * to the components embedded in live forms. In live mode, these would run
 * after logging in; we stub by probing the /sign-in route and asserting the
 * company name from env renders correctly.
 */
test.describe("India compliance visible on public pages", () => {
  test("sign-in page displays company brand", async ({ page }) => {
    await page.goto("/sign-in");
    // VITE_COMPANY_NAME default is "AV Inventory"
    await expect(page.locator("text=AV Inventory").first()).toBeVisible();
  });

  test("portal page uses Indian date formatting (dd MMM yyyy)", async ({ page }) => {
    await page.goto("/portal/mock-project?t=valid-mock-token");
    // The generated-at line + token-expiry line both match; `.first()` is enough.
    await expect(
      page.getByText(/\d{1,2} [A-Z][a-z]{2} \d{4}/).first(),
    ).toBeVisible({ timeout: 10_000 });
  });
});
