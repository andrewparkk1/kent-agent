import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { api, internal } from "./_generated/api";

const http = httpRouter();

/**
 * Telegram webhook endpoint.
 *
 * Register this with Telegram via:
 *   curl -X POST "https://api.telegram.org/bot<BOT_TOKEN>/setWebhook" \
 *     -d "url=https://<CONVEX_SITE_URL>/telegram/webhook&secret_token=<SECRET>"
 *
 * Handles:
 *   - /start <deviceToken>  → links Telegram user to Kent device
 *   - Any other text        → runs the Kent agent via E2B and replies
 */
http.route({
  path: "/telegram/webhook",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    // Verify the secret token header if configured
    const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
    if (secret) {
      const headerSecret = req.headers.get("x-telegram-bot-api-secret-token");
      if (headerSecret !== secret) {
        return new Response("Unauthorized", { status: 401 });
      }
    }

    let update: TelegramUpdate;
    try {
      update = (await req.json()) as TelegramUpdate;
    } catch {
      return new Response("Bad Request", { status: 400 });
    }

    const message = update.message;
    if (!message?.text || !message.from) {
      return new Response("OK", { status: 200 });
    }

    const userId = message.from.id;
    const username = message.from.username;
    const chatId = message.chat.id;
    const text = message.text.trim();

    // Handle /start deep link
    if (text.startsWith("/start ")) {
      const deviceToken = text.slice("/start ".length).trim();
      if (!deviceToken) {
        await sendTelegramMessage(
          chatId,
          "Welcome to Kent! Run `kent init` on your Mac to link your account.",
        );
        return new Response("OK", { status: 200 });
      }

      try {
        await ctx.runMutation(api.telegram.linkDevice, {
          deviceToken,
          telegramUserId: userId,
          telegramUsername: username,
        });

        await sendTelegramMessage(
          chatId,
          "✅ Linked! Kent is now connected to this chat. You can send me messages and I'll respond with your Kent agent.",
        );
      } catch (err) {
        console.error("[telegram webhook] linkDevice failed:", err);
        await sendTelegramMessage(
          chatId,
          "❌ Failed to link. Make sure you've run `kent init` first, then try the link again.",
        );
      }

      return new Response("OK", { status: 200 });
    }

    // Handle bare /start
    if (text === "/start") {
      await sendTelegramMessage(
        chatId,
        "Welcome to Kent! Run `kent init` on your Mac to get your link.",
      );
      return new Response("OK", { status: 200 });
    }

    // ── Run the agent for chat messages ──────────────────────────────

    // Send "thinking..." indicator
    const thinkingMsgId = await sendTelegramMessage(chatId, "🤔 thinking...");

    // Run the agent via E2B (this is async and may take a while)
    try {
      const agentResponse: string = await ctx.runAction(
        internal.agentRunner.runForTelegram,
        {
          telegramUserId: userId,
          prompt: text,
        },
      );

      // Delete "thinking..." message
      if (thinkingMsgId) {
        await deleteTelegramMessage(chatId, thinkingMsgId);
      }

      // Send agent response (split into chunks if needed)
      await sendTelegramChunked(chatId, agentResponse, message.message_id);
    } catch (err) {
      console.error("[telegram webhook] agent run failed:", err);

      if (thinkingMsgId) {
        await deleteTelegramMessage(chatId, thinkingMsgId);
      }

      const errorMsg = err instanceof Error ? err.message : "Unknown error";
      await sendTelegramMessage(
        chatId,
        `❌ Agent error: ${errorMsg}`,
      );
    }

    return new Response("OK", { status: 200 });
  }),
});

// ── Telegram Bot API helpers ────���───────────────────────────────────────────

function getBotToken(): string | null {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    console.error("[telegram webhook] TELEGRAM_BOT_TOKEN not set");
    return null;
  }
  return token;
}

/**
 * Send a message and return the message_id (for later deletion).
 */
async function sendTelegramMessage(
  chatId: number,
  text: string,
  replyToMessageId?: number,
): Promise<number | null> {
  const token = getBotToken();
  if (!token) return null;

  const body: Record<string, unknown> = { chat_id: chatId, text };
  if (replyToMessageId) {
    body.reply_parameters = { message_id: replyToMessageId };
  }

  const res = await fetch(
    `https://api.telegram.org/bot${token}/sendMessage`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
  );

  if (!res.ok) {
    const responseBody = await res.text();
    console.error(`[telegram webhook] sendMessage failed: ${res.status} ${responseBody}`);
    return null;
  }

  const data = (await res.json()) as { result?: { message_id: number } };
  return data.result?.message_id ?? null;
}

async function deleteTelegramMessage(
  chatId: number,
  messageId: number,
): Promise<void> {
  const token = getBotToken();
  if (!token) return;

  try {
    await fetch(
      `https://api.telegram.org/bot${token}/deleteMessage`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: chatId, message_id: messageId }),
      },
    );
  } catch {
    // Non-critical — thinking message stays if delete fails
  }
}

/**
 * Send a long message split into 4096-char chunks (Telegram limit).
 */
async function sendTelegramChunked(
  chatId: number,
  text: string,
  replyToMessageId?: number,
): Promise<void> {
  const MAX_LENGTH = 4096;

  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > 0) {
    if (remaining.length <= MAX_LENGTH) {
      chunks.push(remaining);
      break;
    }
    // Split at newline near the limit
    let splitAt = remaining.lastIndexOf("\n", MAX_LENGTH);
    if (splitAt < MAX_LENGTH * 0.5) {
      splitAt = remaining.lastIndexOf(" ", MAX_LENGTH);
    }
    if (splitAt < MAX_LENGTH * 0.5) {
      splitAt = MAX_LENGTH;
    }
    chunks.push(remaining.slice(0, splitAt));
    remaining = remaining.slice(splitAt).trimStart();
  }

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    if (!chunk) continue;
    await sendTelegramMessage(
      chatId,
      chunk,
      i === 0 ? replyToMessageId : undefined,
    );
  }
}

// ── Telegram types (minimal) ──���─────────────────────────────────────────────

interface TelegramUpdate {
  update_id: number;
  message?: {
    message_id: number;
    from?: { id: number; username?: string };
    chat: { id: number };
    text?: string;
  };
}

export default http;
