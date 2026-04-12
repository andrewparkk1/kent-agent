/**
 * Tests for shared/channels/notify.ts.
 *
 * Mocks channel-state (DB-backed) so no real DB is touched.
 * Channels are pure test doubles implementing the Channel interface.
 */
import { test, expect, describe, beforeEach, mock } from "bun:test";

// Capture calls to mapChannelMessageToThread
type MapCall = { channel: string; messageId: string; threadId: string };
const mapCalls: MapCall[] = [];

mock.module("@shared/channel-state.ts", () => ({
  mapChannelMessageToThread: async (channel: string, messageId: string, threadId: string) => {
    mapCalls.push({ channel, messageId, threadId });
  },
  getThreadForChannelMessage: async () => null,
  getPersistentThreadId: async () => null,
  setPersistentThreadId: async () => {},
}));

import { formatWorkflowNotification, notifyAllChannels } from "@shared/channels/notify.ts";
import type { Channel } from "@shared/channels/types.ts";

// ─── Test channel double ───────────────────────────────────────────────────

class FakeChannel implements Channel {
  readonly name: string;
  sentTexts: string[] = [];
  failNotify: Error | null = null;
  notifyResult: { chatId: string; messageId: string }[];

  constructor(
    name: string,
    notifyResult: { chatId: string; messageId: string }[] = [{ chatId: "c1", messageId: "m1" }],
  ) {
    this.name = name;
    this.notifyResult = notifyResult;
  }

  isConfigured(): boolean {
    return true;
  }

  async sendNotification(text: string) {
    this.sentTexts.push(text);
    if (this.failNotify) throw this.failNotify;
    return this.notifyResult;
  }

  async sendReply(_t: string, _c: string, _r: string): Promise<string> {
    return "reply-id";
  }
  async sendTypingIndicator(_c: string): Promise<void> {}
  async startPolling(): Promise<void> {}
}

// ─── formatWorkflowNotification ─────────────────────────────────────────────

describe("formatWorkflowNotification", () => {
  test("formats successful workflow with output", () => {
    const msg = formatWorkflowNotification("morning-briefing", true, "Here's your briefing.");
    expect(msg).toBe("**morning-briefing** — completed\n\nHere's your briefing.");
  });

  test("formats failed workflow", () => {
    const msg = formatWorkflowNotification("sync-inbox", false, "error!");
    expect(msg).toBe("**sync-inbox** — failed\n\nerror!");
  });

  test("shows '(no output)' when output is empty", () => {
    expect(formatWorkflowNotification("w", true, "")).toBe("**w** — completed\n\n(no output)");
  });

  test("shows '(no output)' when output is whitespace only", () => {
    expect(formatWorkflowNotification("w", true, "   \n\t")).toBe("**w** — completed\n\n(no output)");
  });

  test("trims leading/trailing whitespace from output", () => {
    const msg = formatWorkflowNotification("w", true, "\n  hello\n  ");
    expect(msg).toBe("**w** — completed\n\nhello");
  });

  test("uses 'completed' for success=true, 'failed' for success=false", () => {
    expect(formatWorkflowNotification("a", true, "x")).toContain("completed");
    expect(formatWorkflowNotification("a", false, "x")).toContain("failed");
  });
});

// ─── notifyAllChannels ─────────────────────────────────────────────────────

describe("notifyAllChannels", () => {
  let logs: string[];
  const log = (m: string) => logs.push(m);

  beforeEach(() => {
    logs = [];
    mapCalls.length = 0;
  });

  test("sends notification to each channel", async () => {
    const a = new FakeChannel("chanA");
    const b = new FakeChannel("chanB");
    await notifyAllChannels([a, b], "hello", "thread-1", log);

    expect(a.sentTexts).toEqual(["hello"]);
    expect(b.sentTexts).toEqual(["hello"]);
  });

  test("maps every returned messageId to the thread", async () => {
    const ch = new FakeChannel("chanA", [
      { chatId: "c1", messageId: "m1" },
      { chatId: "c2", messageId: "m2" },
    ]);
    await notifyAllChannels([ch], "text", "thread-xyz", log);

    expect(mapCalls).toHaveLength(2);
    expect(mapCalls[0]).toEqual({ channel: "chanA", messageId: "m1", threadId: "thread-xyz" });
    expect(mapCalls[1]).toEqual({ channel: "chanA", messageId: "m2", threadId: "thread-xyz" });
  });

  test("no channels → no calls, no errors", async () => {
    await notifyAllChannels([], "text", "t", log);
    expect(mapCalls).toHaveLength(0);
    expect(logs).toHaveLength(0);
  });

  test("channel error is logged but doesn't abort other channels", async () => {
    const broken = new FakeChannel("broken");
    broken.failNotify = new Error("boom");
    const working = new FakeChannel("working");

    await notifyAllChannels([broken, working], "text", "t1", log);

    expect(working.sentTexts).toEqual(["text"]);
    expect(logs.length).toBe(1);
    expect(logs[0]).toContain("broken");
    expect(logs[0]).toContain("boom");
    // Working channel still got mapped
    expect(mapCalls.some((c) => c.channel === "working")).toBe(true);
  });

  test("channel with empty notify result → no mapping calls", async () => {
    const ch = new FakeChannel("x", []);
    await notifyAllChannels([ch], "text", "t", log);
    expect(mapCalls).toHaveLength(0);
  });

  test("multiple channels each get their own namespaced mapping", async () => {
    const tg = new FakeChannel("telegram", [{ chatId: "c1", messageId: "t-42" }]);
    const slack = new FakeChannel("slack", [{ chatId: "s1", messageId: "s-99" }]);

    await notifyAllChannels([tg, slack], "update", "thread-1", log);

    expect(mapCalls).toEqual([
      { channel: "telegram", messageId: "t-42", threadId: "thread-1" },
      { channel: "slack", messageId: "s-99", threadId: "thread-1" },
    ]);
  });
});
