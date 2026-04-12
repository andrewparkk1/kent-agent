import { test, expect } from "@playwright/test";
import { installApiMocks } from "./fixtures/mock-api";

test.describe("Activity", () => {
  test("renders activity feed", async ({ page }) => {
    await installApiMocks(page, { unreadCount: 2 });
    await page.route("**/api/activity", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ runs: [] }),
      }),
    );
    await page.goto("/activity");
    await expect(page.getByRole("heading", { name: "Activity" })).toBeVisible();
  });

  test("unread badge appears in sidebar", async ({ page }) => {
    await installApiMocks(page, { unreadCount: 3 });
    await page.goto("/workflows");
    await expect(page.getByText("3").first()).toBeVisible();
  });
});
