import { test, expect } from "@playwright/test";
import { installApiMocks } from "./fixtures/mock-api";

const sampleSource = {
  id: "imessage",
  label: "iMessage",
  itemCount: 42,
  lastSyncAt: Date.now() / 1000 - 60,
  status: "connected",
};

test.describe("Sources page", () => {
  test("renders sources list", async ({ page }) => {
    await installApiMocks(page, {
      sources: [sampleSource],
      counts: { imessage: 42 },
      items: [],
    });
    await page.goto("/sources");
    await expect(page.getByRole("heading", { name: /sources/i }).first()).toBeVisible();
  });

  test("shows daemon stopped state with Start button", async ({ page }) => {
    await installApiMocks(page, { sources: [sampleSource], daemonStatus: "stopped" });
    await page.goto("/sources");
    await expect(page.getByText(/daemon stopped/i)).toBeVisible();
    await expect(page.getByRole("button", { name: /^start$/i })).toBeVisible();
  });

  test("clicking Start posts to /api/daemon/start", async ({ page }) => {
    await installApiMocks(page, { sources: [sampleSource], daemonStatus: "stopped" });
    let started = false;
    await page.route("**/api/daemon/start", (route) => {
      started = true;
      return route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
    });

    await page.goto("/sources");
    await page.getByRole("button", { name: /^start$/i }).click();
    await expect.poll(() => started).toBe(true);
  });

  test("running daemon shows next sync time, no Start button", async ({ page }) => {
    await installApiMocks(page, { sources: [sampleSource], daemonStatus: "running" });
    await page.goto("/sources");
    await expect(page.getByRole("button", { name: /^start$/i })).toBeHidden();
  });
});
