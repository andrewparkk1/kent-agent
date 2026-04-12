import { test, expect } from "@playwright/test";
import { installApiMocks } from "./fixtures/mock-api";

const sampleWorkflow = {
  id: "wf-1",
  name: "Daily Digest",
  description: "Summarize each morning",
  source: "user",
  schedule: "daily",
  enabled: true,
  runCount: 5,
  lastRunAt: Date.now() / 1000 - 3600,
};

test.describe("Workflows", () => {
  test("renders workflow list", async ({ page }) => {
    await installApiMocks(page, { workflows: [sampleWorkflow] });
    await page.route("**/api/workflows", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ workflows: [sampleWorkflow], totalRuns: 5 }),
      }),
    );
    await page.goto("/workflows");
    await expect(page.getByText("Daily Digest")).toBeVisible();
  });

  test("empty state when no workflows", async ({ page }) => {
    await installApiMocks(page, { workflows: [] });
    await page.goto("/workflows");
    await expect(page.getByRole("heading", { name: /workflows/i }).first()).toBeVisible();
  });

  test("clicking workflow opens detail page", async ({ page }) => {
    await installApiMocks(page);
    await page.route("**/api/workflows", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ workflows: [sampleWorkflow], totalRuns: 5 }),
      }),
    );
    await page.route("**/api/workflows/wf-1", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ workflow: sampleWorkflow, runs: [] }),
      }),
    );
    await page.route("**/api/workflows/wf-1/**", (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: "{}" }),
    );

    await page.goto("/workflows");
    await page.getByText("Daily Digest").click();
    await expect(page).toHaveURL(/\/workflow\/wf-1$/);
  });
});
