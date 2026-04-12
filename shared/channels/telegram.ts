/**
 * Telegram channel implementation.
 * Uses the Telegram Bot API via plain fetch (zero external deps).
 * Supports multiple chat IDs — notifications go to all, replies route to the correct one.
 * Auto-discovers new chats: when the bot receives a message from an unknown chat,
 * it auto-adds that chat ID to the config and starts processing messages from it.
 */
import type { Channel, ChannelMessage } from "./types.ts";
import { loadConfig, saveConfig } from "@shared/config.ts";

const API_BASE = "https://api.telegram.org/bot";
const MAX_MESSAGE_LENGTH = 4096;

export const TELEGRAM_DEFAULT_BOT = "@kent_personal_bot";

// ─── Telegram API types ────────────────────────────────────────────────────

interface TgMessage {
  message_id: number;
  from?: { id: number; first_name: string; username?: string };
  chat: { id: number; type: string };
  date: number;
  text?: string;
  reply_to_message?: TgMessage;
}

interface TgUpdate {
  update_id: number;
  message?: TgMessage;
}

// ─── Raw API helpers ───────────────────────────────────────────────────────

async function callApi<T>(botToken: string, method: string, body?: Record<string, unknown>): Promise<T> {
  const res = await fetch(`${API_BASE}${botToken}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Telegram API ${method} failed (${res.status}): ${text}`);
  }
  return res.json() as Promise<T>;
}

/** Escape HTML special chars. */
function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * Convert the markdown the agent produces into Telegram-flavored HTML.
 * Telegram's allowed tags: b, strong, i, em, u, s, code, pre, a, blockquote.
 * HTML parse_mode is more forgiving than Markdown/MarkdownV2 (which requires
 * escaping a dozen special chars and fails the whole message on any mistake).
 */
function toTelegramHtml(md: string): string {
  // Protect code regions from further transforms via placeholders
  const placeholders: string[] = [];
  const stash = (html: string): string => {
    placeholders.push(html);
    return `\u0000${placeholders.length - 1}\u0000`;
  };

  let s = md;

  // Fenced code blocks ```lang\n...\n```
  s = s.replace(/```(\w*)\n?([\s\S]*?)```/g, (_m, _lang, code) =>
    stash(`<pre>${escapeHtml(String(code).replace(/\s+$/, ""))}</pre>`),
  );

  // Inline code `...`
  s = s.replace(/`([^`\n]+)`/g, (_m, code) => stash(`<code>${escapeHtml(String(code))}</code>`));

  // Escape everything else
  s = escapeHtml(s);

  // Links [text](url) — brackets and parens weren't touched by escapeHtml
  s = s.replace(/\[([^\]\n]+)\]\(([^)\s]+)\)/g, (_m, text, url) => {
    const safeUrl = String(url).replace(/"/g, "&quot;");
    return `<a href="${safeUrl}">${text}</a>`;
  });

  // Bold **text**
  s = s.replace(/\*\*([^*\n]+)\*\*/g, "<b>$1</b>");

  // Italic _text_ (single-underscore, word-boundary)
  s = s.replace(/(^|[\s(])_([^_\n]+)_(?=$|[\s).,!?])/g, "$1<i>$2</i>");

  // Headings # Heading → bold
  s = s.replace(/^#{1,6}\s+(.+)$/gm, "<b>$1</b>");

  // Bullet lists "- item" / "* item" at line starts → "• item"
  s = s.replace(/^[\t ]*[-*][\t ]+/gm, "• ");

  // Restore code placeholders
  s = s.replace(/\u0000(\d+)\u0000/g, (_m, i) => placeholders[Number(i)] ?? "");

  return s;
}

/** Strip HTML tags for plain-text fallback. */
function stripHtml(s: string): string {
  return s
    .replace(/<[^>]+>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&");
}

/** Send a single message (≤4096 chars). */
async function apiSendMessage(
  botToken: string,
  chatId: string,
  text: string,
  replyToMessageId?: number,
): Promise<number> {
  const truncated = text.length > MAX_MESSAGE_LENGTH
    ? text.slice(0, MAX_MESSAGE_LENGTH - 4) + "\n..."
    : text;

  const html = toTelegramHtml(truncated);

  const body: Record<string, unknown> = {
    chat_id: chatId,
    text: html,
    parse_mode: "HTML",
    link_preview_options: { is_disabled: true },
  };
  if (replyToMessageId) body.reply_to_message_id = replyToMessageId;

  try {
    const result = await callApi<{ ok: boolean; result?: TgMessage }>(botToken, "sendMessage", body);
    return result.result?.message_id ?? 0;
  } catch {
    // If HTML parsing fails (mismatched tags, unsupported entity), fall back to plain text
    const plain = stripHtml(html);
    const fallbackBody: Record<string, unknown> = { chat_id: chatId, text: plain };
    if (replyToMessageId) fallbackBody.reply_to_message_id = replyToMessageId;
    const result = await callApi<{ ok: boolean; result?: TgMessage }>(botToken, "sendMessage", fallbackBody);
    return result.result?.message_id ?? 0;
  }
}

/** Send a long message, splitting into multiple if needed. Returns the last message ID. */
async function apiSendLongMessage(
  botToken: string,
  chatId: string,
  text: string,
  replyToMessageId?: number,
): Promise<number> {
  if (text.length <= MAX_MESSAGE_LENGTH) {
    return apiSendMessage(botToken, chatId, text, replyToMessageId);
  }

  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > 0) {
    if (remaining.length <= MAX_MESSAGE_LENGTH) {
      chunks.push(remaining);
      break;
    }
    let splitAt = remaining.lastIndexOf("\n\n", MAX_MESSAGE_LENGTH);
    if (splitAt < MAX_MESSAGE_LENGTH / 2) {
      splitAt = remaining.lastIndexOf("\n", MAX_MESSAGE_LENGTH);
    }
    if (splitAt < MAX_MESSAGE_LENGTH / 2) {
      splitAt = MAX_MESSAGE_LENGTH;
    }
    chunks.push(remaining.slice(0, splitAt));
    remaining = remaining.slice(splitAt).trimStart();
  }

  let lastMessageId = 0;
  for (const chunk of chunks) {
    lastMessageId = await apiSendMessage(
      botToken, chatId, chunk,
      lastMessageId || replyToMessageId,
    );
  }
  return lastMessageId;
}

/** Long-poll for new updates. */
async function apiGetUpdates(botToken: string, offset?: number, timeout = 30): Promise<TgUpdate[]> {
  const body: Record<string, unknown> = { timeout, allowed_updates: ["message"] };
  if (offset !== undefined) body.offset = offset;

  const result = await callApi<{ ok: boolean; result: TgUpdate[] }>(botToken, "getUpdates", body);
  return result.result ?? [];
}

/** Send "typing..." chat action. */
async function apiSendTyping(botToken: string, chatId: string): Promise<void> {
  await callApi(botToken, "sendChatAction", { chat_id: chatId, action: "typing" });
}

// ─── Channel implementation ───────────────────────────────────────────────

export class TelegramChannel implements Channel {
  readonly name = "telegram";
  private botToken: string;
  private chatIds: Set<string>;
  /** Tracks chat type so notifications only go to private chats. */
  private chatTypes: Map<string, string> = new Map();

  constructor(botToken: string, chatIds: string[]) {
    this.botToken = botToken;
    this.chatIds = new Set(chatIds.filter(Boolean));
  }

  isConfigured(): boolean {
    return !!this.botToken;
  }

  /** Send notification to private chats only (not group chats). */
  async sendNotification(text: string): Promise<{ chatId: string; messageId: string }[]> {
    const results: { chatId: string; messageId: string }[] = [];
    for (const chatId of this.chatIds) {
      // Skip group chats — notifications are personal (workflow results, briefings, etc.)
      const chatType = this.chatTypes.get(chatId);
      if (chatType && chatType !== "private") continue;

      const msgId = await apiSendLongMessage(this.botToken, chatId, text);
      results.push({ chatId, messageId: String(msgId) });
    }
    return results;
  }

  async sendReply(text: string, chatId: string, replyToMessageId: string): Promise<string> {
    const msgId = await apiSendLongMessage(
      this.botToken, chatId, text,
      Number(replyToMessageId),
    );
    return String(msgId);
  }

  async sendTypingIndicator(chatId: string): Promise<void> {
    await apiSendTyping(this.botToken, chatId);
  }

  async startPolling(onMessage: (msg: ChannelMessage) => Promise<void>): Promise<void> {
    let offset: number | undefined;

    while (true) {
      if (!this.isConfigured()) {
        await sleep(30_000);
        continue;
      }

      try {
        const updates = await apiGetUpdates(this.botToken, offset, 30);

        for (const update of updates) {
          offset = update.update_id + 1;
          if (!update.message?.text) continue;

          const msgChatId = String(update.message.chat.id);
          const chatType = update.message.chat.type; // "private", "group", "supergroup"

          // Track chat type so we know where to send notifications
          this.chatTypes.set(msgChatId, chatType);

          // Auto-discover: if this chat isn't registered yet, add it
          if (!this.chatIds.has(msgChatId)) {
            this.chatIds.add(msgChatId);
            this.persistChatIds();
          }

          const msg: ChannelMessage = {
            id: String(update.message.message_id),
            text: update.message.text,
            from: update.message.from?.first_name ?? "unknown",
            chatId: msgChatId,
            replyToMessageId: update.message.reply_to_message
              ? String(update.message.reply_to_message.message_id)
              : undefined,
          };

          try {
            await onMessage(msg);
          } catch {
            // Handler errors shouldn't kill the polling loop
          }
        }
      } catch (e) {
        const errMsg = String(e);
        if (!errMsg.includes("timeout") && !errMsg.includes("ECONNRESET")) {
          // Log will be handled by the caller
        }
        await sleep(5_000);
      }
    }
  }

  /** Persist current chat IDs to config so they survive daemon restarts. */
  private persistChatIds(): void {
    try {
      const config = loadConfig();
      config.telegram.chat_ids = [...this.chatIds];
      saveConfig(config);
    } catch {
      // Non-fatal — chat will be re-discovered on next message
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
