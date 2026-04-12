import { test, expect } from "@playwright/test";
import { installApiMocks } from "./fixtures/mock-api";

test.describe("Settings page", () => {
  test.beforeEach(async ({ page }) => {
    await installApiMocks(page);
  });

  test("renders settings page", async ({ page }) => {
    await page.goto("/settings");
    await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
  });

  test("URL persists for settings page", async ({ page }) => {
    await page.goto("/settings");
    await expect(page).toHaveURL(/\/settings$/);
  });
});
