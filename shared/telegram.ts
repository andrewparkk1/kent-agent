/**
 * Telegram Bot API client — zero dependencies, just fetch.
 * Handles sending messages, receiving updates, and mapping
 * Telegram messages ↔ Kent threads via the kv table.
 */
import { getDb } from "./db/connection.ts";

const API_BASE = "https://api.telegram.org/bot";
const MAX_MESSAGE_LENGTH = 4096;

// ─── Types ─────────────────────────────────────────────────────────────────

export interface TelegramMessage {
  message_id: number;
  from?: { id: number; first_name: string; username?: string };
  chat: { id: number; type: string };
  date: number;
  text?: string;
  reply_to_message?: TelegramMessage;
}

export interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
}

interface SendMessageResult {
  ok: boolean;
  result?: TelegramMessage;
}

// ─── API helpers ───────────────────────────────────────────────────────────

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

// ─── Public API ────────────────────────────────────────────────────────────

/** Send a text message. Returns the sent message's ID. */
export async function sendMessage(
  botToken: string,
  chatId: string,
  text: string,
  opts?: { replyToMessageId?: number; parseMode?: "Markdown" | "HTML" },
): Promise<number> {
  // Telegram limits messages to 4096 chars — truncate with ellipsis if needed
  const truncated = text.length > MAX_MESSAGE_LENGTH
    ? text.slice(0, MAX_MESSAGE_LENGTH - 4) + "\n..."
    : text;

  const body: Record<string, unknown> = {
    chat_id: chatId,
    text: truncated,
  };
  if (opts?.replyToMessageId) body.reply_to_message_id = opts.replyToMessageId;
  if (opts?.parseMode) body.parse_mode = opts.parseMode;

  const result = await callApi<SendMessageResult>(botToken, "sendMessage", body);
  return result.result?.message_id ?? 0;
}

/** Send a long message, splitting into multiple messages if needed. Returns the last message ID. */
export async function sendLongMessage(
  botToken: string,
  chatId: string,
  text: string,
  opts?: { replyToMessageId?: number },
): Promise<number> {
  if (text.length <= MAX_MESSAGE_LENGTH) {
    return sendMessage(botToken, chatId, text, opts);
  }

  // Split on paragraph boundaries where possible
  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > 0) {
    if (remaining.length <= MAX_MESSAGE_LENGTH) {
      chunks.push(remaining);
      break;
    }
    // Try to split at a paragraph break within the limit
    let splitAt = remaining.lastIndexOf("\n\n", MAX_MESSAGE_LENGTH);
    if (splitAt < MAX_MESSAGE_LENGTH / 2) {
      // No good paragraph break — split at last newline
      splitAt = remaining.lastIndexOf("\n", MAX_MESSAGE_LENGTH);
    }
    if (splitAt < MAX_MESSAGE_LENGTH / 2) {
      // No good newline — hard split
      splitAt = MAX_MESSAGE_LENGTH;
    }
    chunks.push(remaining.slice(0, splitAt));
    remaining = remaining.slice(splitAt).trimStart();
  }

  let lastMessageId = 0;
  for (const chunk of chunks) {
    lastMessageId = await sendMessage(botToken, chatId, chunk, {
      replyToMessageId: lastMessageId || opts?.replyToMessageId,
    });
  }
  return lastMessageId;
}

/** Fetch new updates via long polling. */
export async function getUpdates(
  botToken: string,
  offset?: number,
  timeout = 30,
): Promise<TelegramUpdate[]> {
  const body: Record<string, unknown> = {
    timeout,
    allowed_updates: ["message"],
  };
  if (offset !== undefined) body.offset = offset;

  const result = await callApi<{ ok: boolean; result: TelegramUpdate[] }>(
    botToken,
    "getUpdates",
    body,
  );
  return result.result ?? [];
}

// ─── Thread ↔ Telegram message mapping (via kv table) ──────────────────────

const KV_PREFIX_MSG_TO_THREAD = "tg:msg:";
const KV_PREFIX_THREAD_TO_MSG = "tg:thread:";
const KV_PERSISTENT_THREAD = "tg:persistent_thread";

/** Store a bidirectional mapping between a Telegram message and a Kent thread. */
export async function mapMessageToThread(telegramMessageId: number, threadId: string): Promise<void> {
  const db = getDb();
  const msgKey = `${KV_PREFIX_MSG_TO_THREAD}${telegramMessageId}`;
  const threadKey = `${KV_PREFIX_THREAD_TO_MSG}${threadId}`;

  await db
    .insertInto("kv")
    .values({ key: msgKey, value: threadId })
    .onConflict((oc) => oc.column("key").doUpdateSet({ value: threadId }))
    .execute();

  await db
    .insertInto("kv")
    .values({ key: threadKey, value: String(telegramMessageId) })
    .onConflict((oc) => oc.column("key").doUpdateSet({ value: String(telegramMessageId) }))
    .execute();
}

/** Look up which Kent thread a Telegram message belongs to. */
export async function getThreadForMessage(telegramMessageId: number): Promise<string | null> {
  const db = getDb();
  const row = await db
    .selectFrom("kv")
    .where("key", "=", `${KV_PREFIX_MSG_TO_THREAD}${telegramMessageId}`)
    .select("value")
    .executeTakeFirst();
  return row?.value ?? null;
}

/** Look up the last Telegram message ID for a Kent thread. */
export async function getMessageForThread(threadId: string): Promise<number | null> {
  const db = getDb();
  const row = await db
    .selectFrom("kv")
    .where("key", "=", `${KV_PREFIX_THREAD_TO_MSG}${threadId}`)
    .select("value")
    .executeTakeFirst();
  return row ? Number(row.value) : null;
}

/** Get or create the persistent chat thread ID for the Telegram channel. */
export async function getPersistentThreadId(): Promise<string | null> {
  const db = getDb();
  const row = await db
    .selectFrom("kv")
    .where("key", "=", KV_PERSISTENT_THREAD)
    .select("value")
    .executeTakeFirst();
  return row?.value ?? null;
}

export async function setPersistentThreadId(threadId: string): Promise<void> {
  const db = getDb();
  await db
    .insertInto("kv")
    .values({ key: KV_PERSISTENT_THREAD, value: threadId })
    .onConflict((oc) => oc.column("key").doUpdateSet({ value: threadId }))
    .execute();
}
