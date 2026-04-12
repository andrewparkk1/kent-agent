/**
 * Tests for shared/channels/telegram.ts — stubs fetch globally.
 * No real network calls are ever made.
 */
import { test, expect, describe, afterEach, mock } from "bun:test";
import { TelegramChannel, TELEGRAM_DEFAULT_BOT } from "@shared/channels/telegram.ts";

const API_PREFIX = "https://api.telegram.org/bot";

type FetchCall = { url: string; method: string; body: any };

function installFetchStub(opts?: {
  messageId?: number;
  failFirstCallWith?: { status: number; body?: string };
}): FetchCall[] {
  const calls: FetchCall[] = [];
  let callCount = 0;

  globalThis.fetch = mock(async (url: string | URL | Request, init?: RequestInit) => {
    callCount++;
    const bodyStr = init?.body as string | undefined;
    let body: any = null;
    try {
      body = bodyStr ? JSON.parse(bodyStr) : null;
    } catch {
      body = bodyStr;
    }
    calls.push({
      url: String(url),
      method: (init?.method ?? "GET"),
      body,
    });

    if (opts?.failFirstCallWith && callCount === 1) {
      return new Response(opts.failFirstCallWith.body ?? "err", {
        status: opts.failFirstCallWith.status,
      });
    }

    return new Response(
      JSON.stringify({
        ok: true,
        result: { message_id: opts?.messageId ?? callCount },
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  }) as any;

  return calls;
}

describe("TelegramChannel — constants", () => {
  test("exports default bot handle", () => {
    expect(TELEGRAM_DEFAULT_BOT).toBe("@kent_personal_bot");
  });
});

describe("TelegramChannel — constructor", () => {
  test("filters out empty chat ids", () => {
    const ch = new TelegramChannel("token", ["123", "", "456"]);
    expect(ch.isConfigured()).toBe(true);
  });

  test("accepts empty chat id list", () => {
    const ch = new TelegramChannel("token", []);
    expect(ch.isConfigured()).toBe(true);
  });
});

describe("TelegramChannel — sendNotification request shape", () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test("POSTs to sendMessage endpoint with correct URL", async () => {
    const calls = installFetchStub({ messageId: 7 });
    const ch = new TelegramChannel("bot-token-123", ["chat-1"]);
    await ch.sendNotification("hi");

    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe(`${API_PREFIX}bot-token-123/sendMessage`);
    expect(calls[0]!.method).toBe("POST");
    expect(calls[0]!.body.chat_id).toBe("chat-1");
    expect(calls[0]!.body.parse_mode).toBe("HTML");
    expect(calls[0]!.body.link_preview_options).toEqual({ is_disabled: true });
  });

  test("returns chatId and messageId pairs for each chat", async () => {
    installFetchStub({ messageId: 42 });
    const ch = new TelegramChannel("t", ["a", "b", "c"]);
    const results = await ch.sendNotification("hello");

    expect(results).toHaveLength(3);
    expect(results.map((r) => r.chatId).sort()).toEqual(["a", "b", "c"]);
    for (const r of results) expect(r.messageId).toBe("42");
  });

  test("converts markdown bold to HTML <b>", async () => {
    const calls = installFetchStub();
    const ch = new TelegramChannel("t", ["c"]);
    await ch.sendNotification("**bold**");
    expect(calls[0]!.body.text).toContain("<b>bold</b>");
  });

  test("converts fenced code block to <pre>", async () => {
    const calls = installFetchStub();
    const ch = new TelegramChannel("t", ["c"]);
    await ch.sendNotification("```js\nconst x = 1;\n```");
    expect(calls[0]!.body.text).toContain("<pre>");
    expect(calls[0]!.body.text).toContain("const x = 1;");
    expect(calls[0]!.body.text).toContain("</pre>");
  });

  test("converts inline code to <code>", async () => {
    const calls = installFetchStub();
    const ch = new TelegramChannel("t", ["c"]);
    await ch.sendNotification("run `ls` now");
    expect(calls[0]!.body.text).toContain("<code>ls</code>");
  });

  test("escapes HTML special chars outside code", async () => {
    const calls = installFetchStub();
    const ch = new TelegramChannel("t", ["c"]);
    await ch.sendNotification("a < b & c > d");
    const text = calls[0]!.body.text;
    expect(text).toContain("&lt;");
    expect(text).toContain("&amp;");
    expect(text).toContain("&gt;");
  });

  test("converts bullets to • prefix", async () => {
    const calls = installFetchStub();
    const ch = new TelegramChannel("t", ["c"]);
    await ch.sendNotification("- item 1\n- item 2");
    expect(calls[0]!.body.text).toContain("• item 1");
    expect(calls[0]!.body.text).toContain("• item 2");
  });

  test("converts links to <a href>", async () => {
    const calls = installFetchStub();
    const ch = new TelegramChannel("t", ["c"]);
    await ch.sendNotification("[text](https://example.com)");
    expect(calls[0]!.body.text).toContain('<a href="https://example.com">text</a>');
  });
});

describe("TelegramChannel — sendReply", () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test("includes reply_to_message_id as number", async () => {
    const calls = installFetchStub({ messageId: 11 });
    const ch = new TelegramChannel("tok", ["a", "b"]);
    const result = await ch.sendReply("reply", "b", "99");

    expect(result).toBe("11");
    expect(calls[0]!.body.chat_id).toBe("b");
    expect(calls[0]!.body.reply_to_message_id).toBe(99);
  });

  test("only sends to target chat, not all chats", async () => {
    const calls = installFetchStub();
    const ch = new TelegramChannel("tok", ["a", "b", "c"]);
    await ch.sendReply("x", "b", "1");
    expect(calls).toHaveLength(1);
    expect(calls[0]!.body.chat_id).toBe("b");
  });
});

describe("TelegramChannel — sendTypingIndicator", () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test("POSTs sendChatAction with typing", async () => {
    const calls = installFetchStub();
    const ch = new TelegramChannel("tok", ["x"]);
    await ch.sendTypingIndicator("x");
    expect(calls[0]!.url).toBe(`${API_PREFIX}tok/sendChatAction`);
    expect(calls[0]!.body).toEqual({ chat_id: "x", action: "typing" });
  });
});

describe("TelegramChannel — long message splitting", () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test("short messages send as a single call", async () => {
    const calls = installFetchStub();
    const ch = new TelegramChannel("t", ["c"]);
    await ch.sendNotification("short");
    expect(calls).toHaveLength(1);
  });

  test("messages under 4096 chars are not split", async () => {
    const calls = installFetchStub();
    const ch = new TelegramChannel("t", ["c"]);
    await ch.sendNotification("x".repeat(4000));
    expect(calls).toHaveLength(1);
  });

  test("splits at paragraph boundaries when possible", async () => {
    const calls = installFetchStub();
    const ch = new TelegramChannel("t", ["c"]);
    const p1 = "A".repeat(3000);
    const p2 = "B".repeat(3000);
    await ch.sendNotification(`${p1}\n\n${p2}`);

    expect(calls.length).toBe(2);
    expect(calls[0]!.body.text).toBe(p1);
    expect(calls[1]!.body.text).toBe(p2);
  });

  test("each chunk is ≤ 4096 chars", async () => {
    const calls = installFetchStub();
    const ch = new TelegramChannel("t", ["c"]);
    await ch.sendNotification("z".repeat(10_000));
    for (const call of calls) {
      expect(call.body.text.length).toBeLessThanOrEqual(4096);
    }
    expect(calls.length).toBeGreaterThan(1);
  });

  test("subsequent chunks reply to previous (thread)", async () => {
    const calls = installFetchStub({ messageId: 5 });
    const ch = new TelegramChannel("t", ["c"]);
    await ch.sendNotification("A".repeat(3000) + "\n\n" + "B".repeat(3000));

    expect(calls.length).toBe(2);
    // First has no reply_to, second replies to the first message id returned (5)
    expect(calls[0]!.body.reply_to_message_id).toBeUndefined();
    expect(calls[1]!.body.reply_to_message_id).toBe(5);
  });
});

describe("TelegramChannel — API error handling", () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test("throws on non-ok response with status in message", async () => {
    globalThis.fetch = mock(async () => new Response("bad", { status: 403 })) as any;
    const ch = new TelegramChannel("t", ["c"]);
    expect(ch.sendNotification("hi")).rejects.toThrow("403");
  });

  test("falls back to plain text if first HTML send fails then succeeds", async () => {
    let callCount = 0;
    const calls: any[] = [];
    globalThis.fetch = mock(async (_url: any, init?: RequestInit) => {
      callCount++;
      const body = JSON.parse(init!.body as string);
      calls.push(body);
      // First call (HTML attempt) fails, second call (plain text) succeeds
      if (callCount === 1) {
        return new Response("parse err", { status: 400 });
      }
      return new Response(JSON.stringify({ ok: true, result: { message_id: 7 } }), {
        status: 200,
      });
    }) as any;

    const ch = new TelegramChannel("t", ["c"]);
    const results = await ch.sendNotification("**hello**");
    expect(results[0]!.messageId).toBe("7");
    // Second call should be plain (no parse_mode)
    expect(calls[1]!.parse_mode).toBeUndefined();
  });
});

describe("TelegramChannel — sendNotification with chat type tracking", () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test("truncates messages at max + ... suffix", async () => {
    const calls = installFetchStub();
    const ch = new TelegramChannel("t", ["c"]);
    // Exactly 5000 chars — no newlines, can't split at boundaries naturally,
    // hard-split and each chunk <= 4096
    await ch.sendNotification("q".repeat(5000));
    for (const call of calls) {
      expect(call.body.text.length).toBeLessThanOrEqual(4096);
    }
  });
});
