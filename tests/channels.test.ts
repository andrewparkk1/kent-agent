import { test, expect, describe, beforeEach, afterEach, mock } from "bun:test";
import type { Channel, ChannelMessage } from "@shared/channels/types.ts";
import { TelegramChannel } from "@shared/channels/telegram.ts";
import { getChannels } from "@shared/channels/index.ts";
import type { Config } from "@shared/config.ts";
import { DEFAULT_CONFIG } from "@shared/config.ts";

// ─── Channel interface contract tests ──────────────────────────────────────
// These tests verify the interface contract that any channel must satisfy.

describe("Channel interface", () => {
  test("TelegramChannel implements all required methods", () => {
    const channel = new TelegramChannel("token", "chatid");
    expect(channel.name).toBe("telegram");
    expect(typeof channel.isConfigured).toBe("function");
    expect(typeof channel.sendNotification).toBe("function");
    expect(typeof channel.sendReply).toBe("function");
    expect(typeof channel.sendTypingIndicator).toBe("function");
    expect(typeof channel.startPolling).toBe("function");
  });

  test("TelegramChannel.name is 'telegram'", () => {
    const channel = new TelegramChannel("token", "123");
    expect(channel.name).toBe("telegram");
  });
});

// ─── TelegramChannel.isConfigured() ────────────────────────────────────────

describe("TelegramChannel.isConfigured", () => {
  test("returns true when both bot_token and chat_id are set", () => {
    const channel = new TelegramChannel("123:ABC", "456");
    expect(channel.isConfigured()).toBe(true);
  });

  test("returns false when bot_token is empty", () => {
    const channel = new TelegramChannel("", "456");
    expect(channel.isConfigured()).toBe(false);
  });

  test("returns false when chat_id is empty", () => {
    const channel = new TelegramChannel("123:ABC", "");
    expect(channel.isConfigured()).toBe(false);
  });

  test("returns false when both are empty", () => {
    const channel = new TelegramChannel("", "");
    expect(channel.isConfigured()).toBe(false);
  });
});

// ─── getChannels() registry ────────────────────────────────────────────────

describe("getChannels", () => {
  test("returns empty array when telegram not configured", () => {
    const config = { ...DEFAULT_CONFIG };
    const channels = getChannels(config);
    expect(channels).toHaveLength(0);
  });

  test("returns telegram channel when configured", () => {
    const config: Config = {
      ...DEFAULT_CONFIG,
      telegram: { bot_token: "123:ABC", chat_id: "456" },
    };
    const channels = getChannels(config);
    expect(channels).toHaveLength(1);
    expect(channels[0]!.name).toBe("telegram");
  });

  test("telegram channel is configured in returned list", () => {
    const config: Config = {
      ...DEFAULT_CONFIG,
      telegram: { bot_token: "123:ABC", chat_id: "456" },
    };
    const channels = getChannels(config);
    expect(channels[0]!.isConfigured()).toBe(true);
  });
});

// ─── Telegram API integration tests (mock fetch) ──────────────────────────

describe("TelegramChannel.sendNotification", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test("sends message to correct endpoint and returns message ID", async () => {
    let capturedUrl = "";
    let capturedBody: any = null;

    globalThis.fetch = mock(async (url: string | URL | Request, init?: RequestInit) => {
      capturedUrl = String(url);
      capturedBody = JSON.parse(init?.body as string);
      return new Response(JSON.stringify({
        ok: true,
        result: { message_id: 42 },
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    }) as any;

    const channel = new TelegramChannel("test-token", "chat-123");
    const msgId = await channel.sendNotification("Hello world");

    expect(msgId).toBe("42");
    expect(capturedUrl).toContain("test-token");
    expect(capturedUrl).toContain("sendMessage");
    expect(capturedBody.chat_id).toBe("chat-123");
    expect(capturedBody.text).toBe("Hello world");
  });

  test("splits messages over 4096 chars into multiple calls", async () => {
    const sentMessages: string[] = [];

    globalThis.fetch = mock(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(init?.body as string);
      if (body.text) sentMessages.push(body.text);
      return new Response(JSON.stringify({
        ok: true,
        result: { message_id: sentMessages.length },
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    }) as any;

    const channel = new TelegramChannel("token", "chat");
    const longText = "x".repeat(5000);
    await channel.sendNotification(longText);

    // Should be split into multiple messages, each <=4096
    expect(sentMessages.length).toBeGreaterThan(1);
    for (const msg of sentMessages) {
      expect(msg.length).toBeLessThanOrEqual(4096);
    }
  });

  test("throws on API error", async () => {
    globalThis.fetch = mock(async () => {
      return new Response("Unauthorized", { status: 401 });
    }) as any;

    const channel = new TelegramChannel("bad-token", "chat");
    expect(channel.sendNotification("test")).rejects.toThrow("401");
  });
});

describe("TelegramChannel.sendReply", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test("includes reply_to_message_id in API call", async () => {
    let capturedBody: any = null;

    globalThis.fetch = mock(async (_url: string | URL | Request, init?: RequestInit) => {
      capturedBody = JSON.parse(init?.body as string);
      return new Response(JSON.stringify({
        ok: true,
        result: { message_id: 99 },
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    }) as any;

    const channel = new TelegramChannel("token", "chat");
    const msgId = await channel.sendReply("Reply text", "55");

    expect(msgId).toBe("99");
    expect(capturedBody.reply_to_message_id).toBe(55);
    expect(capturedBody.text).toBe("Reply text");
  });
});

describe("TelegramChannel.sendTypingIndicator", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test("calls sendChatAction with typing action", async () => {
    let capturedUrl = "";
    let capturedBody: any = null;

    globalThis.fetch = mock(async (url: string | URL | Request, init?: RequestInit) => {
      capturedUrl = String(url);
      capturedBody = JSON.parse(init?.body as string);
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as any;

    const channel = new TelegramChannel("token", "chat-456");
    await channel.sendTypingIndicator();

    expect(capturedUrl).toContain("sendChatAction");
    expect(capturedBody.action).toBe("typing");
    expect(capturedBody.chat_id).toBe("chat-456");
  });
});

// ─── Channel message splitting ─────────────────────────────────────────────

describe("Long message splitting", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test("splits messages at paragraph boundaries when over limit", async () => {
    const sentMessages: string[] = [];

    globalThis.fetch = mock(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(init?.body as string);
      if (body.text) sentMessages.push(body.text);
      return new Response(JSON.stringify({
        ok: true,
        result: { message_id: sentMessages.length },
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    }) as any;

    const channel = new TelegramChannel("token", "chat");
    // Create text with two paragraphs that together exceed 4096 chars
    const para1 = "A".repeat(3000);
    const para2 = "B".repeat(3000);
    const longText = `${para1}\n\n${para2}`;

    await channel.sendNotification(longText);

    // Should split at the paragraph boundary
    expect(sentMessages.length).toBe(2);
    expect(sentMessages[0]).toBe(para1);
    expect(sentMessages[1]).toBe(para2);
  });
});

// ─── Config defaults ──────────────────────────────────────────────────────

describe("Config telegram defaults", () => {
  test("DEFAULT_CONFIG has telegram section", () => {
    expect(DEFAULT_CONFIG).toHaveProperty("telegram");
    expect(DEFAULT_CONFIG.telegram).toHaveProperty("bot_token");
    expect(DEFAULT_CONFIG.telegram).toHaveProperty("chat_id");
  });

  test("telegram defaults to empty strings", () => {
    expect(DEFAULT_CONFIG.telegram.bot_token).toBe("");
    expect(DEFAULT_CONFIG.telegram.chat_id).toBe("");
  });
});
