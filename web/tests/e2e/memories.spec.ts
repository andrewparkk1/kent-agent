import { test, expect } from "@playwright/test";
import { installApiMocks, sampleMemories, sampleMemoryDetails } from "./fixtures/mock-api";

test.describe("Memories list", () => {
  test.beforeEach(async ({ page }) => {
    await installApiMocks(page, {
      memories: sampleMemories,
      memoryDetails: sampleMemoryDetails,
    });
  });

  test("renders all memories", async ({ page }) => {
    await page.goto("/memories");
    await expect(page.getByRole("heading", { name: "Memories" })).toBeVisible();
    await expect(page.getByText("Andrew Park", { exact: true })).toBeVisible();
    await expect(page.getByText("Kent Agent", { exact: true })).toBeVisible();
    await expect(page.getByText("Machine Learning", { exact: true })).toBeVisible();
  });

  test("search filters memories", async ({ page }) => {
    await page.goto("/memories");
    await page.getByPlaceholder("Search memories...").fill("Andrew");
    await expect(page.getByText("Andrew Park", { exact: true })).toBeVisible();
    await expect(page.getByText("Machine Learning", { exact: true })).toBeHidden();
  });

  test("type filter chips narrow results", async ({ page }) => {
    await page.goto("/memories");
    await page.getByRole("button", { name: "Person", exact: true }).click();
    await expect(page.getByText("Andrew Park", { exact: true })).toBeVisible();
    await expect(page.getByText("Kent Agent", { exact: true })).toBeHidden();

    await page.getByRole("button", { name: "All", exact: true }).click();
    await expect(page.getByText("Kent Agent", { exact: true })).toBeVisible();
  });

  test("clicking a memory opens detail page", async ({ page }) => {
    await page.goto("/memories");
    await page.getByText("Andrew Park", { exact: true }).click();
    await expect(page).toHaveURL(/\/memory\/mem-1$/);
    await expect(page.getByRole("heading", { name: "Andrew Park" })).toBeVisible();
  });

  test("empty state when no memories", async ({ page }) => {
    await installApiMocks(page, { memories: [] });
    await page.goto("/memories");
    await expect(page.getByText("No memories yet")).toBeVisible();
  });
});

test.describe("Memory detail", () => {
  test.beforeEach(async ({ page }) => {
    await installApiMocks(page, {
      memories: sampleMemories,
      memoryDetails: sampleMemoryDetails,
    });
  });

  test("renders summary, body, sources, and back link", async ({ page }) => {
    await page.setViewportSize({ width: 1400, height: 900 });
    await page.goto("/memory/mem-1");
    await expect(page.getByRole("heading", { name: "Andrew Park" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Background" })).toBeVisible();
    await expect(page.getByText("Andrew is the creator")).toBeVisible();
    await expect(page.getByText("imessage", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: /back to memories/i })).toBeVisible();
  });

  test("wiki links navigate to linked memory", async ({ page }) => {
    await page.goto("/memory/mem-1");
    // [[Kent Agent]] in summary becomes a clickable link
    await page.getByRole("button", { name: "Kent Agent" }).first().click();
    await expect(page.getByRole("heading", { name: "Kent Agent" })).toBeVisible();
  });

  test("see also and linked from sidebar render", async ({ page }) => {
    await page.setViewportSize({ width: 1400, height: 900 });
    await page.goto("/memory/mem-1");
    await expect(page.getByRole("heading", { name: /see also/i })).toBeVisible();
    await expect(page.getByRole("heading", { name: /linked from/i })).toBeVisible();
  });

  test("inline edit updates memory", async ({ page }) => {
    await page.goto("/memory/mem-1");
    await page.getByRole("button", { name: /^edit$/i }).click();

    const titleInput = page.locator('input[value="Andrew Park"]');
    await expect(titleInput).toBeVisible();
    await titleInput.fill("Andrew P. Park");
    await page.getByRole("button", { name: /^save$/i }).click();

    await expect(page.getByRole("heading", { name: "Andrew P. Park" })).toBeVisible();
  });

  test("cancel edit reverts changes", async ({ page }) => {
    await page.goto("/memory/mem-1");
    await page.getByRole("button", { name: /^edit$/i }).click();
    await page.locator('input[value="Andrew Park"]').fill("Should not save");
    await page.getByRole("button", { name: /^cancel$/i }).click();
    await expect(page.getByRole("heading", { name: "Andrew Park" })).toBeVisible();
  });

  test("archive removes memory and returns to list", async ({ page }) => {
    await page.goto("/memory/mem-1");
    await page.getByRole("button", { name: /^archive$/i }).click();
    await expect(page).toHaveURL(/\/memories$/);
    await expect(page.getByText("Andrew Park")).toBeHidden();
  });

  test("back button returns to memories list", async ({ page }) => {
    await page.goto("/memory/mem-1");
    await page.getByRole("button", { name: /back to memories/i }).click();
    await expect(page).toHaveURL(/\/memories$/);
  });
});
