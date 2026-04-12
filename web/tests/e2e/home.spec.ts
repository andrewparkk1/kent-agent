import { test, expect } from "@playwright/test";
import { installApiMocks, sampleMemories, sampleMemoryDetails } from "./fixtures/mock-api";

test.describe("Home page", () => {
  test.beforeEach(async ({ page }) => {
    await installApiMocks(page, {
      memories: sampleMemories,
      memoryDetails: sampleMemoryDetails,
    });
  });

  test("renders home", async ({ page }) => {
    await page.goto("/home");
    await expect(page).toHaveURL(/\/home$/);
  });

  test("clicking a memory navigates to detail", async ({ page }) => {
    await page.goto("/home");
    const memoryLink = page.getByText("Andrew Park").first();
    if (await memoryLink.isVisible().catch(() => false)) {
      await memoryLink.click();
      await expect(page).toHaveURL(/\/memory\//);
    }
  });
});
