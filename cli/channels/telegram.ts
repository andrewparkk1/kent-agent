import { Bot } from "grammy";
import { loadConfig, saveConfig } from "@shared/config.ts";
import type { Channel } from "./channel.ts";

/**
 * Telegram channel implementation using grammy.
 *
 * RECEIVE: Accepts messages from whitelisted users, runs them through the
 *          agent runner, and sends the response back.
 * NOTIFY:  Pushes workflow results or notifications to all allowed users.
 *
 * Auto-whitelist: If allowed_user_ids is empty, the first user to message
 * the bot is automatically whitelisted and saved to config.
 */
export class TelegramChannel implements Channel {
  readonly name = "telegram";
  private bot: Bot | null = null;
  private allowedUserIds: number[] = [];

  private getBot(): Bot {
    if (this.bot) return this.bot;

    const config = loadConfig();
    const token = config.channels.telegram.bot_token;

    if (!token) {
      throw new Error(
        "Telegram bot token not configured. Run 'kent init' to set it up, " +
          "or add it to ~/.kent/config.json under channels.telegram.bot_token.",
      );
    }

    this.allowedUserIds = config.channels.telegram.allowed_user_ids ?? [];
    this.bot = new Bot(token);
    return this.bot;
  }

  private autoWhitelist(userId: number, username?: string): void {
    if (this.allowedUserIds.includes(userId)) return;
    this.allowedUserIds.push(userId);
    // Persist to config
    const config = loadConfig();
    config.channels.telegram.allowed_user_ids = this.allowedUserIds;
    saveConfig(config);
    const name = username ? ` (@${username})` : "";
    console.log(`[telegram] Auto-whitelisted user ${userId}${name} — saved to config`);
  }

  async start(): Promise<void> {
    const bot = this.getBot();

    // Security: only respond to whitelisted user IDs
    // If whitelist is empty, auto-whitelist the first user
    bot.on("message:text", async (ctx) => {
      const userId = ctx.from?.id;

      if (!userId) return;

      // Auto-whitelist first user if no whitelist configured
      if (this.allowedUserIds.length === 0) {
        this.autoWhitelist(userId, ctx.from?.username);
        await ctx.reply(`✓ You're now connected to Kent. Your user ID (${userId}) has been saved.\n\nAsk me anything.`);
        return;
      }

      if (!this.allowedUserIds.includes(userId)) {
        console.log(`[telegram] Ignoring message from unauthorized user: ${userId}`);
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
      if (this.allowedUserIds.length > 0 && userId && !this.allowedUserIds.includes(userId)) {
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
      `[telegram] Allowed user IDs: ${
        this.allowedUserIds.length > 0
          ? this.allowedUserIds.join(", ")
          : "ALL (no whitelist configured — add user IDs to config for security)"
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

    if (this.allowedUserIds.length === 0) {
      console.warn(
        "[telegram] No allowed_user_ids configured — cannot send notifications. " +
          "Add user IDs to ~/.kent/config.json under channels.telegram.allowed_user_ids",
      );
      return;
    }

    // Send to all allowed users
    for (const userId of this.allowedUserIds) {
      try {
        await this.sendChunked(userId, message);
      } catch (err) {
        console.error(
          `[telegram] Failed to notify user ${userId}:`,
          err instanceof Error ? err.message : err,
        );
      }
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
