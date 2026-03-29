import { Bot } from "grammy";
import { loadConfig } from "@shared/config.ts";
import { CONVEX_URL } from "@shared/config.ts";
import type { Channel } from "./channel.ts";

/**
 * Telegram channel implementation using grammy.
 *
 * RECEIVE: Accepts messages from the linked Telegram user, runs them through the
 *          agent runner, and sends the response back.
 * NOTIFY:  Pushes workflow results or notifications to the linked user.
 *
 * The bot token comes from the TELEGRAM_BOT_TOKEN env var — Kent owns the bot,
 * so this is set in the daemon/server environment, not by the user.
 *
 * The linked user's Telegram ID comes from Convex (set during `kent init` deep link flow).
 */
export class TelegramChannel implements Channel {
  readonly name = "telegram";
  private bot: Bot | null = null;
  private linkedUserId: number | null = null;

  private getBot(): Bot {
    if (this.bot) return this.bot;

    const token = process.env.TELEGRAM_BOT_TOKEN;

    if (!token) {
      throw new Error(
        "TELEGRAM_BOT_TOKEN environment variable not set. " +
          "This should be configured in the daemon/server environment.",
      );
    }

    // Load the linked user ID from config (set during kent init deep link)
    const config = loadConfig();
    this.linkedUserId = config.telegram.user_id;

    this.bot = new Bot(token);
    return this.bot;
  }

  /**
   * Fetch the linked Telegram user ID from Convex for a given device token.
   * Falls back to the locally cached value in config.
   */
  private async fetchLinkedUserId(): Promise<number | null> {
    const config = loadConfig();

    // Try Convex first for the freshest data
    try {
      const res = await fetch(`${CONVEX_URL}/api/query`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          path: "telegram:checkLink",
          args: { deviceToken: config.core.device_token },
        }),
      });

      if (res.ok) {
        const data = (await res.json()) as {
          value?: { linked: boolean; userId?: number; username?: string };
        };
        if (data.value?.linked && data.value.userId) {
          return data.value.userId;
        }
      }
    } catch {
      // Fall back to local config
    }

    return config.telegram.user_id;
  }

  async start(): Promise<void> {
    const bot = this.getBot();

    // Resolve the linked user ID
    this.linkedUserId = await this.fetchLinkedUserId();

    // Handle /start command (deep link flow from `kent init`)
    bot.command("start", async (ctx) => {
      const deviceToken = ctx.match?.trim(); // grammy puts the deep link payload in ctx.match
      const userId = ctx.from?.id;
      const username = ctx.from?.username;

      if (!userId) return;

      if (!deviceToken) {
        // Bare /start with no deep link token
        await ctx.reply(
          "Welcome to Kent! To link your account, run `kent init` on your machine and follow the Telegram step.",
        );
        return;
      }

      console.log(`[telegram] /start deep link from ${userId} (token: ${deviceToken.slice(0, 8)}...)`);

      try {
        const res = await fetch(`${CONVEX_URL}/api/mutation`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            path: "telegram:linkDevice",
            args: {
              deviceToken,
              telegramUserId: userId,
              telegramUsername: username,
            },
          }),
        });

        if (!res.ok) {
          const body = await res.text();
          console.error(`[telegram] linkDevice failed: ${res.status} ${body}`);
          await ctx.reply("❌ Failed to link your account. Please check the link from your Kent app and try again.");
          return;
        }

        // Update local state so the bot starts responding immediately
        this.linkedUserId = userId;

        await ctx.reply("✅ Linked! Kent is now connected to this chat. You can send me messages and I'll respond.");
        console.log(`[telegram] Successfully linked user ${userId} (@${username})`);
      } catch (err) {
        console.error("[telegram] linkDevice error:", err);
        await ctx.reply("❌ Something went wrong linking your account. Please try again.");
      }
    });

    // Security: only respond to the linked Telegram user
    bot.on("message:text", async (ctx) => {
      const userId = ctx.from?.id;

      if (!userId) return;

      if (this.linkedUserId && userId !== this.linkedUserId) {
        console.log(`[telegram] Ignoring message from unlinked user: ${userId}`);
        return;
      }

      if (!this.linkedUserId) {
        console.log(`[telegram] No linked user — ignoring message from ${userId}`);
        return;
      }

      const prompt = ctx.message.text;
      console.log(`[telegram] Message from ${userId}: ${prompt.slice(0, 80)}...`);

      // Send "thinking..." indicator
      const thinking = await ctx.reply("thinking...", {
        reply_parameters: { message_id: ctx.message.message_id },
      });

      try {
        const response = await this.runPrompt(prompt);

        // Delete the "thinking..." message
        try {
          await ctx.api.deleteMessage(ctx.chat.id, thinking.message_id);
        } catch {
          // Ignore if we can't delete it
        }

        // Split response into 4096-char chunks (Telegram message limit)
        await this.sendChunked(ctx.chat.id, response, ctx.message.message_id);
      } catch (err) {
        const errorMsg =
          err instanceof Error ? err.message : "Unknown error occurred";

        try {
          await ctx.api.deleteMessage(ctx.chat.id, thinking.message_id);
        } catch {
          // Ignore
        }

        await ctx.reply(`Error: ${errorMsg}`, {
          reply_parameters: { message_id: ctx.message.message_id },
        });
      }
    });

    // Handle document/file messages
    bot.on("message:document", async (ctx) => {
      const userId = ctx.from?.id;
      if (this.linkedUserId && userId !== this.linkedUserId) {
        return;
      }
      if (!this.linkedUserId) {
        return;
      }

      const caption = ctx.message.caption ?? "Analyze this file";
      const thinking = await ctx.reply(
        `File received. Processing with prompt: "${caption.slice(0, 50)}..."`,
      );

      try {
        const doc = ctx.message.document;
        const file = await ctx.api.getFile(doc.file_id);
        const fileUrl = `https://api.telegram.org/file/bot${this.getBot().token}/${file.file_path}`;
        const fileResponse = await fetch(fileUrl);
        const fileContent = await fileResponse.text();

        const promptWithFile = `${caption}\n\n--- File: ${doc.file_name ?? "unknown"} ---\n${fileContent}`;
        const response = await this.runPrompt(promptWithFile);

        try {
          await ctx.api.deleteMessage(ctx.chat.id, thinking.message_id);
        } catch {
          // Ignore if we can't delete it
        }

        await this.sendChunked(ctx.chat.id, response, ctx.message.message_id);
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : "Unknown error occurred";
        try {
          await ctx.api.deleteMessage(ctx.chat.id, thinking.message_id);
        } catch {
          // Ignore
        }
        await ctx.reply(`Error processing file: ${errorMsg}`, {
          reply_parameters: { message_id: ctx.message.message_id },
        });
      }
    });

    console.log("[telegram] Starting bot...");
    console.log(
      `[telegram] Linked user ID: ${
        this.linkedUserId
          ? this.linkedUserId
          : "NONE — link via 'kent init' first"
      }`,
    );

    // bot.start() blocks until stopped
    await bot.start({
      onStart: (info) => {
        console.log(`[telegram] Bot @${info.username} is running`);
      },
    });
  }

  async stop(): Promise<void> {
    if (this.bot) {
      console.log("[telegram] Stopping bot...");
      await this.bot.stop();
      this.bot = null;
    }
  }

  async notify(message: string, _runId?: string): Promise<void> {
    const bot = this.getBot();

    if (!this.linkedUserId) {
      // Try fetching from Convex in case it was linked after boot
      this.linkedUserId = await this.fetchLinkedUserId();
    }

    if (!this.linkedUserId) {
      console.warn(
        "[telegram] No linked Telegram user — cannot send notifications. " +
          "Run 'kent init' to link your Telegram account.",
      );
      return;
    }

    try {
      await this.sendChunked(this.linkedUserId, message);
    } catch (err) {
      console.error(
        `[telegram] Failed to notify user ${this.linkedUserId}:`,
        err instanceof Error ? err.message : err,
      );
    }
  }

  // ── Private helpers ──────────────────────────────────────────────────

  /**
   * Run a prompt through the agent runner.
   * Uses dynamic import to avoid circular deps and to pick up whatever
   * runner is configured (local, cloud, auto).
   */
  private async runPrompt(prompt: string): Promise<string> {
    const { getRunner } = await import("@daemon/runner.ts");
    const config = loadConfig();
    const runner = getRunner(config);
    const result = await runner.run(prompt, undefined, undefined);
    return result.output;
  }

  /**
   * Send a message split into 4096-char chunks (Telegram's limit).
   */
  private async sendChunked(
    chatId: number,
    text: string,
    replyToMessageId?: number,
  ): Promise<void> {
    const MAX_LENGTH = 4096;
    const bot = this.getBot();

    const chunks: string[] = [];
    let remaining = text;
    while (remaining.length > 0) {
      if (remaining.length <= MAX_LENGTH) {
        chunks.push(remaining);
        break;
      }
      // Try to split at a newline near the limit
      let splitAt = remaining.lastIndexOf("\n", MAX_LENGTH);
      if (splitAt < MAX_LENGTH * 0.5) {
        // No good newline break — split at space
        splitAt = remaining.lastIndexOf(" ", MAX_LENGTH);
      }
      if (splitAt < MAX_LENGTH * 0.5) {
        // No good break point — hard split
        splitAt = MAX_LENGTH;
      }
      chunks.push(remaining.slice(0, splitAt));
      remaining = remaining.slice(splitAt).trimStart();
    }

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      if (!chunk) continue;
      if (i === 0 && replyToMessageId) {
        await bot.api.sendMessage(chatId, chunk, {
          reply_parameters: { message_id: replyToMessageId },
        });
      } else {
        await bot.api.sendMessage(chatId, chunk);
      }
    }
  }
}
