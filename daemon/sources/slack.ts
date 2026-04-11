/**
 * Slack source — pulls messages from channels and DMs via the Slack Web API.
 * Requires a Slack user/bot token (xoxb-… or xoxp-…) set via SLACK_TOKEN env
 * var or ~/.kent/config.json keys.slack.
 */
import type { Source, SyncState, SyncOptions, Item } from "./types";
import { loadConfig } from "@shared/config.ts";

/** Thin wrapper around Slack Web API GET endpoints. */
async function slackApi(method: string, params: Record<string, string>, token: string): Promise<any> {
  const url = new URL(`https://slack.com/api/${method}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url.toString(), { headers: { Authorization: `Bearer ${token}` } });
  return res.json();
}

/** Resolve token from env or config. Returns null if unavailable. */
function resolveToken(): string | null {
  if (process.env.SLACK_TOKEN) return process.env.SLACK_TOKEN;
  try {
    const config = loadConfig();
    const token = (config.keys as any).slack;
    if (token && typeof token === "string" && token.length > 0) return token;
  } catch {
    // config not available
  }
  return null;
}

/** Cache for user ID → display name lookups. */
const userCache = new Map<string, string>();

async function resolveUserName(userId: string, token: string): Promise<string> {
  const cached = userCache.get(userId);
  if (cached !== undefined) return cached;

  try {
    const data = await slackApi("users.info", { user: userId }, token);
    const name =
      data?.user?.profile?.display_name ||
      data?.user?.profile?.real_name ||
      data?.user?.name ||
      userId;
    userCache.set(userId, name);
    return name;
  } catch {
    userCache.set(userId, userId);
    return userId;
  }
}

/** Small delay to avoid hitting Slack rate limits. */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export const slack: Source = {
  name: "slack",

  async fetchNew(state: SyncState, options?: SyncOptions): Promise<Item[]> {
    const token = resolveToken();
    if (!token) {
      console.warn("[slack] No token found — set SLACK_TOKEN env or keys.slack in config");
      return [];
    }

    const lastSync = state.getLastSync("slack");
    const defaultDays = options?.defaultDays ?? 365;
    const oldest =
      lastSync > 0
        ? String(lastSync)
        : defaultDays === 0
          ? "0"
          : String(Math.floor(Date.now() / 1000 - defaultDays * 24 * 60 * 60));

    // Identify the authenticated user so we can tag isFromMe
    let authUserId = "";
    try {
      const authData = await slackApi("auth.test", {}, token);
      if (authData?.ok) authUserId = authData.user_id ?? "";
    } catch {
      // non-fatal
    }

    // Fetch all conversations (channels, groups, DMs, multi-party DMs)
    const channels: Array<{ id: string; name: string; type: string }> = [];
    let cursor = "";
    do {
      const params: Record<string, string> = {
        types: "public_channel,private_channel,mpim,im",
        limit: "200",
        exclude_archived: "true",
      };
      if (cursor) params.cursor = cursor;

      const data = await slackApi("conversations.list", params, token);
      if (!data?.ok) break;

      for (const ch of data.channels ?? []) {
        let type: string;
        if (ch.is_im) type = "dm";
        else if (ch.is_mpim) type = "group";
        else type = "channel";

        channels.push({
          id: ch.id,
          name: ch.name ?? ch.id,
          type,
        });
      }

      cursor = data.response_metadata?.next_cursor ?? "";
    } while (cursor);

    // Resolve DM channel names to the other user's display name
    for (const ch of channels) {
      if (ch.type === "dm" && ch.name === ch.id) {
        // For IM channels the user field holds the other party's ID
        // We already have the channel object from the list; look up the user
        try {
          const info = await slackApi("conversations.info", { channel: ch.id }, token);
          const userId = info?.channel?.user;
          if (userId) {
            ch.name = await resolveUserName(userId, token);
          }
        } catch {
          // keep channel ID as name
        }
      }
    }

    const items: Item[] = [];

    for (const ch of channels) {
      const params: Record<string, string> = {
        channel: ch.id,
        limit: String(options?.limit ?? 200),
        oldest,
      };

      try {
        const data = await slackApi("conversations.history", params, token);
        if (!data?.ok) continue;

        for (const msg of data.messages ?? []) {
          // Skip bot messages and messages without text
          if (msg.subtype === "bot_message" || msg.bot_id) continue;
          if (!msg.text) continue;

          const ts = msg.ts ?? "0";
          const userId = msg.user ?? "";
          const userName = userId ? await resolveUserName(userId, token) : "unknown";

          items.push({
            source: "slack",
            externalId: `slack-${ch.id}-${ts}`,
            content: msg.text,
            metadata: {
              channel: ch.id,
              channelName: ch.name,
              channelType: ch.type,
              userName,
              isFromMe: userId === authUserId,
            },
            createdAt: Math.floor(parseFloat(ts)),
          });
        }
      } catch {
        // skip channels we can't read
      }

      options?.onProgress?.(items.length);

      // Rate limit: small delay between channel history fetches
      await delay(100);
    }

    return items;
  },
};
