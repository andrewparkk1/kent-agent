/**
 * Telegram long-polling loop — runs alongside the daemon.
 * Receives incoming messages from Telegram, routes them to the agent,
 * and sends responses back. Maintains a persistent chat thread per channel.
 */
import { loadConfig } from "@shared/config.ts";
import { createThread, addMessage, getMessages, finishThread } from "@shared/db.ts";
import { InProcessRunner } from "./inprocess-runner.ts";
import {
  getUpdates,
  sendLongMessage,
  getThreadForMessage,
  mapMessageToThread,
  getPersistentThreadId,
  setPersistentThreadId,
  type TelegramUpdate,
} from "@shared/telegram.ts";

/** Log helper shared with daemon. */
type LogFn = (message: string) => void;

/**
 * Start the Telegram polling loop. Runs indefinitely.
 * Call this from the daemon main loop — it manages its own timing.
 */
export async function startTelegramPolling(log: LogFn): Promise<void> {
  let offset: number | undefined;

  log("Telegram polling started");

  while (true) {
    const config = loadConfig();
    const { bot_token, chat_id } = config.telegram;

    if (!bot_token || !chat_id) {
      // Telegram not configured — sleep and retry (config might be updated)
      await sleep(30_000);
      continue;
    }

    try {
      const updates = await getUpdates(bot_token, offset, 30);

      for (const update of updates) {
        offset = update.update_id + 1;

        if (!update.message?.text) continue;

        // Only process messages from our configured chat
        if (String(update.message.chat.id) !== chat_id) continue;

        try {
          await handleIncomingMessage(update.message.text, update.message, config, log);
        } catch (e) {
          log(`Telegram: error handling message — ${e}`);
        }
      }
    } catch (e) {
      const errMsg = String(e);
      // Network errors during long poll are expected (timeout, connection reset)
      if (!errMsg.includes("timeout") && !errMsg.includes("ECONNRESET")) {
        log(`Telegram: polling error — ${errMsg}`);
      }
      // Back off on error
      await sleep(5_000);
    }
  }
}

/**
 * Handle an incoming Telegram message:
 * 1. If it's a reply to a known message → route to that thread
 * 2. Otherwise → route to the persistent chat thread
 * 3. Run the agent and send the response back
 */
async function handleIncomingMessage(
  text: string,
  msg: TelegramUpdate["message"] & {},
  config: ReturnType<typeof loadConfig>,
  log: LogFn,
): Promise<void> {
  const { bot_token, chat_id } = config.telegram;

  log(`Telegram: received message from ${msg.from?.first_name ?? "unknown"}: "${text.slice(0, 80)}"`);

  // Resolve which Kent thread this message belongs to
  let threadId: string | null = null;

  // If replying to a specific message, try to find its thread
  if (msg.reply_to_message) {
    threadId = await getThreadForMessage(msg.reply_to_message.message_id);
  }

  // Fall back to persistent thread for the channel
  if (!threadId) {
    threadId = await getPersistentThreadId();
  }

  // Create a new persistent thread if none exists
  if (!threadId) {
    threadId = await createThread("Telegram Chat", { type: "chat" });
    await setPersistentThreadId(threadId);
    log(`Telegram: created persistent chat thread ${threadId}`);
  }

  // Store the user message
  await addMessage(threadId, "user", text);

  // Build conversation history from the thread
  const history = await getMessages(threadId, 50);
  const priorMessages = history
    .filter((m) => m.role === "user" || m.role === "assistant")
    .slice(0, -1); // Exclude the message we just added

  const conversationHistory = priorMessages.length > 0
    ? priorMessages.map((m) => `${m.role === "user" ? "Human" : "Assistant"}: ${m.content}`).join("\n\n")
    : "";

  // Run the agent
  await finishThread(threadId, "running");
  const runner = new InProcessRunner(config);

  let agentOutput = "";
  try {
    const result = await runner.run(text, undefined, (chunk: string, type: "text" | "tool") => {
      if (type === "text") agentOutput += chunk;
    }, { threadId, conversationHistory });

    agentOutput = result.output || agentOutput;
    await finishThread(threadId, result.exitCode === 0 ? "done" : "error");

    if (!agentOutput.trim()) {
      agentOutput = "I processed your message but had no text response.";
    }
  } catch (e) {
    log(`Telegram: agent error — ${e}`);
    await finishThread(threadId, "error");
    agentOutput = "Sorry, I encountered an error processing your message.";
  }

  // Send response back to Telegram as a reply
  try {
    const replyMsgId = await sendLongMessage(bot_token, chat_id, agentOutput, {
      replyToMessageId: msg.message_id,
    });
    // Map the response message to this thread so future replies route correctly
    await mapMessageToThread(replyMsgId, threadId);
  } catch (e) {
    log(`Telegram: failed to send response — ${e}`);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
