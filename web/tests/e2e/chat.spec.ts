import { test, expect } from "@playwright/test";
import { installApiMocks } from "./fixtures/mock-api";

test.describe("Chat", () => {
  test.beforeEach(async ({ page }) => {
    await installApiMocks(page);
  });

  test("send a message and receive a single assistant reply", async ({ page }) => {
    let chatCalls = 0;
    await page.route("**/api/chat", async (route) => {
      chatCalls++;
      await route.fulfill({
        status: 200,
        contentType: "text/event-stream",
        body: [
          `data: ${JSON.stringify({ delta: "Hello " })}\n\n`,
          `data: ${JSON.stringify({ delta: "world!" })}\n\n`,
          `data: [DONE]\n\n`,
        ].join(""),
      });
    });

    await page.goto("/chat");
    const input = page.getByPlaceholder(/message kent/i);
    await input.click();
    await input.pressSequentially("Hi Kent");
    await input.press("Enter");

    await expect(page.getByText("Hi Kent")).toBeVisible();
    await expect(page.getByText(/hello world/i)).toBeVisible();

    // Regression: assistant message should appear exactly once
    expect(await page.getByText(/hello world/i).count()).toBe(1);
    expect(chatCalls).toBe(1);
  });

  test("escape stops streaming", async ({ page }) => {
    await page.route("**/api/chat", async (route) => {
      await new Promise((r) => setTimeout(r, 5000));
      await route.fulfill({ status: 200, contentType: "text/event-stream", body: "" });
    });

    await page.goto("/chat");
    const input = page.getByPlaceholder(/message kent/i);
    await input.fill("Slow request");
    await input.press("Enter");

    await page.keyboard.press("Escape");
    // Input should be available again
    await expect(input).toBeEnabled();
  });

  test("loading existing thread renders prior messages", async ({ page }) => {
    await installApiMocks(page, {
      threadMessages: {
        "thread-existing": [
          { id: 1, role: "user", content: "Earlier question", created_at: Date.now() / 1000 - 60 },
          { id: 2, role: "assistant", content: "Earlier answer", created_at: Date.now() / 1000 - 30 },
        ],
      },
    });
    await page.goto("/chat/thread-existing");
    await expect(page.getByText("Earlier question")).toBeVisible();
    await expect(page.getByText("Earlier answer")).toBeVisible();
  });
});
