import { test, expect, describe } from "bun:test";
import { MockSyncState, validateItem, LIVE } from "./_helpers.ts";
import { createSlackSource, slack } from "@daemon/sources/slack.ts";

// ─── Fixture API builder ──────────────────────────────────────────────────

interface SlackFixture {
  authUserId?: string;
  channels: Array<{
    id: string;
    name?: string;
    is_im?: boolean;
    is_mpim?: boolean;
  }>;
  history: Record<string, any[]>;
  users: Record<string, { display_name?: string; real_name?: string; name?: string }>;
}

function makeFetcher(fx: SlackFixture): typeof fetch {
  return (async (input: any): Promise<Response> => {
    const url = typeof input === "string" ? input : input.url ?? input.toString();
    const u = new URL(url);
    const method = u.pathname.replace(/^\/api\//, "");

    const json = (data: any) =>
      new Response(JSON.stringify(data), {
        status: 200,
        headers: { "content-type": "application/json" },
      });

    if (method === "auth.test") {
      return json({ ok: true, user_id: fx.authUserId ?? "UAUTH" });
    }
    if (method === "conversations.list") {
      return json({ ok: true, channels: fx.channels });
    }
    if (method === "conversations.info") {
      const ch = u.searchParams.get("channel");
      const channel = fx.channels.find((c) => c.id === ch);
      return json({ ok: true, channel });
    }
    if (method === "conversations.history") {
      const ch = u.searchParams.get("channel") ?? "";
      return json({ ok: true, messages: fx.history[ch] ?? [] });
    }
    if (method === "users.info") {
      const uid = u.searchParams.get("user") ?? "";
      const user = fx.users[uid];
      if (!user) return json({ ok: false });
      return json({
        ok: true,
        user: {
          name: user.name ?? uid,
          profile: { display_name: user.display_name, real_name: user.real_name },
        },
      });
    }
    return json({ ok: false, error: "unknown" });
  }) as unknown as typeof fetch;
}

const FIXTURE: SlackFixture = {
  authUserId: "U_ME",
  channels: [
    { id: "C_GEN", name: "general" },
    { id: "C_DEV", name: "dev" },
  ],
  history: {
    C_GEN: [
      { ts: "1699920000.000100", user: "U_ME", text: "Hello team", thread_ts: null },
      { ts: "1699920100.000200", user: "U_BOB", text: "Hi Alice", thread_ts: "1699920000.000100" },
    ],
    C_DEV: [
      { ts: "1699930000.000300", user: "U_BOB", text: "Ship it" },
      { ts: "1699930050.000400", subtype: "bot_message", bot_id: "B1", text: "bot spam" },
      { ts: "1699930100.000500", user: "U_ME", text: "" },
    ],
  },
  users: {
    U_ME: { display_name: "Alice", real_name: "Alice A" },
    U_BOB: { display_name: "Bob", real_name: "Bob B" },
  },
};

describe("slack source (mocked)", () => {
  test("exported slack still conforms to Source interface", () => {
    expect(slack.name).toBe("slack");
    expect(typeof slack.fetchNew).toBe("function");
  });

  test("returns empty array when no token", async () => {
    const src = createSlackSource({
      token: null,
      fetcher: makeFetcher(FIXTURE),
      delayMs: 0,
    });
    const items = await src.fetchNew(new MockSyncState());
    expect(items).toEqual([]);
  });

  test("parses messages across 2 channels with correct externalIds and metadata", async () => {
    const src = createSlackSource({
      token: "xoxb-test",
      fetcher: makeFetcher(FIXTURE),
      delayMs: 0,
    });
    const items = await src.fetchNew(new MockSyncState(), { defaultDays: 365 });

    for (const item of items) validateItem(item, "slack", /^slack-/);

    // 3 messages: 2 in C_GEN + 1 in C_DEV (bot + empty skipped)
    expect(items.length).toBe(3);

    const first = items.find((i) => i.externalId === "slack-C_GEN-1699920000.000100")!;
    expect(first).toBeDefined();
    expect(first.content).toBe("Hello team");
    expect(first.metadata.channel).toBe("C_GEN");
    expect(first.metadata.channelName).toBe("general");
    expect(first.metadata.channelType).toBe("channel");
    expect(first.metadata.user).toBe("U_ME");
    expect(first.metadata.userName).toBe("Alice");
    expect(first.metadata.isFromMe).toBe(true);
    expect(first.metadata.threadTs).toBe(null);
    expect(first.createdAt).toBe(1699920000);

    const second = items.find((i) => i.externalId === "slack-C_GEN-1699920100.000200")!;
    expect(second).toBeDefined();
    expect(second.content).toBe("Hi Alice");
    expect(second.metadata.user).toBe("U_BOB");
    expect(second.metadata.userName).toBe("Bob");
    expect(second.metadata.isFromMe).toBe(false);
    expect(second.metadata.threadTs).toBe("1699920000.000100");

    const dev = items.find((i) => i.externalId === "slack-C_DEV-1699930000.000300")!;
    expect(dev).toBeDefined();
    expect(dev.content).toBe("Ship it");
    expect(dev.metadata.channelName).toBe("dev");
    expect(dev.metadata.user).toBe("U_BOB");
  });

  test("honors lastSync via oldest param (server-side filter simulation)", async () => {
    const filtering: typeof fetch = (async (input: any): Promise<Response> => {
      const url = typeof input === "string" ? input : input.url ?? input.toString();
      const u = new URL(url);
      if (u.pathname === "/api/conversations.history") {
        const oldest = parseFloat(u.searchParams.get("oldest") ?? "0");
        const ch = u.searchParams.get("channel") ?? "";
        const all = FIXTURE.history[ch] ?? [];
        const msgs = all.filter((m) => parseFloat(m.ts) > oldest);
        return new Response(JSON.stringify({ ok: true, messages: msgs }), {
          headers: { "content-type": "application/json" },
        });
      }
      return makeFetcher(FIXTURE)(input);
    }) as unknown as typeof fetch;

    const src = createSlackSource({ token: "x", fetcher: filtering, delayMs: 0 });
    const state = new MockSyncState();
    state.resetSync("slack", 1699925000);
    const items = await src.fetchNew(state);
    expect(items.length).toBe(1);
    expect(items[0]!.externalId).toBe("slack-C_DEV-1699930000.000300");
  });

  test.skipIf(!LIVE)("LIVE: pulls real Slack messages", async () => {
    const items = await slack.fetchNew(new MockSyncState(), { defaultDays: 1, limit: 5 });
    for (const item of items) validateItem(item, "slack", /^slack-/);
  }, 120_000);
});
