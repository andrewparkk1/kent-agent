import { test, expect } from "@playwright/test";
import { installApiMocks } from "./fixtures/mock-api";

test.describe("First-run setup", () => {
  test("redirects to /setup when needsSetup is true", async ({ page }) => {
    await installApiMocks(page, { needsSetup: true });
    await page.goto("/workflows");
    await expect(page).toHaveURL(/\/setup$/);
  });

  test("does not redirect when setup is complete", async ({ page }) => {
    await installApiMocks(page, { needsSetup: false });
    await page.goto("/workflows");
    await expect(page).toHaveURL(/\/workflows$/);
  });

  test("setup page renders directly", async ({ page }) => {
    await installApiMocks(page, { needsSetup: true });
    await page.goto("/setup");
    await expect(page).toHaveURL(/\/setup$/);
    // Sidebar should NOT render on setup page
    await expect(page.getByRole("button", { name: /memories/i })).toBeHidden();
  });
});
