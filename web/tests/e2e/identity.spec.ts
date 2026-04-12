import { test, expect } from "@playwright/test";
import { installApiMocks } from "./fixtures/mock-api";

test.describe("Identity page", () => {
  test("loads identity from API", async ({ page }) => {
    await installApiMocks(page, {
      identity: { name: "Andrew", bio: "Builder of things", facts: ["Lives in SF"] },
    });
    await page.goto("/identity");
    await expect(page.getByRole("heading", { name: /identity/i }).first()).toBeVisible();
  });

  test("renders empty state when no identity set", async ({ page }) => {
    await installApiMocks(page, { identity: { name: "", bio: "", facts: [] } });
    await page.goto("/identity");
    await expect(page.getByRole("heading", { name: /identity/i }).first()).toBeVisible();
  });
});
