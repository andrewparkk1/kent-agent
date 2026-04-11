/**
 * Telegram channel implementation.
 * Uses the Telegram Bot API via plain fetch (zero external deps).
 * Supports multiple chat IDs — notifications go to all, replies route to the correct one.
 */
import type { Channel, ChannelMessage } from "./types.ts";

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

  const body: Record<string, unknown> = { chat_id: chatId, text: truncated };
  if (replyToMessageId) body.reply_to_message_id = replyToMessageId;

  const result = await callApi<{ ok: boolean; result?: TgMessage }>(botToken, "sendMessage", body);
  return result.result?.message_id ?? 0;
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

  constructor(botToken: string, chatIds: string[]) {
    this.botToken = botToken;
    this.chatIds = new Set(chatIds.filter(Boolean));
  }

  isConfigured(): boolean {
    return !!(this.botToken && this.chatIds.size > 0);
  }

  async sendNotification(text: string): Promise<{ chatId: string; messageId: string }[]> {
    const results: { chatId: string; messageId: string }[] = [];
    for (const chatId of this.chatIds) {
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
          if (!this.chatIds.has(msgChatId)) continue;

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
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
