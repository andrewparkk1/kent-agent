import { test, expect } from "@playwright/test";
import { installApiMocks, sampleMemories, sampleMemoryDetails } from "./fixtures/mock-api";

test.describe("Navigation & routing", () => {
  test.beforeEach(async ({ page }) => {
    await installApiMocks(page, {
      memories: sampleMemories,
      memoryDetails: sampleMemoryDetails,
      workflows: [],
    });
  });

  test("default route lands on workflows", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveURL(/\/workflows$/);
  });

  test("sidebar navigates between top-level pages", async ({ page }) => {
    await page.goto("/workflows");

    await page.getByRole("button", { name: /memories/i }).first().click();
    await expect(page).toHaveURL(/\/memories$/);

    await page.getByRole("button", { name: /sources/i }).first().click();
    await expect(page).toHaveURL(/\/sources$/);

    await page.getByRole("button", { name: /settings/i }).first().click();
    await expect(page).toHaveURL(/\/settings$/);
  });

  test("browser back/forward restore page state", async ({ page }) => {
    await page.goto("/memories");
    await page.getByRole("button", { name: /sources/i }).first().click();
    await expect(page).toHaveURL(/\/sources$/);

    await page.goBack();
    await expect(page).toHaveURL(/\/memories$/);

    await page.goForward();
    await expect(page).toHaveURL(/\/sources$/);
  });

  test("deep link to memory detail loads directly", async ({ page }) => {
    await page.goto("/memory/mem-1");
    await expect(page.getByRole("heading", { name: "Andrew Park" })).toBeVisible();
  });

  test("unknown route falls back to workflows view", async ({ page }) => {
    await page.goto("/totally-not-a-page");
    // The URL stays as-is, but the app renders the workflows page
    await expect(page.getByRole("heading", { name: "Workflows" })).toBeVisible();
  });
});
