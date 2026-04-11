/**
 * Channel message handler — runs alongside the daemon.
 * Channel-agnostic: works with any Channel implementation (Telegram, Slack, etc.).
 *
 * For each incoming message:
 *   1. Resolve which Kent thread it belongs to (reply context or persistent thread)
 *   2. Show a typing indicator
 *   3. Run the agent
 *   4. Send the response back via the channel
 */
import { loadConfig } from "@shared/config.ts";
import { createThread, addMessage, getMessages, finishThread } from "@shared/db.ts";
import { InProcessRunner } from "./inprocess-runner.ts";
import type { Channel, ChannelMessage } from "@shared/channels/types.ts";
import { getThreadForChannelMessage, mapChannelMessageToThread, getPersistentThreadId, setPersistentThreadId } from "@shared/channel-state.ts";

type LogFn = (message: string) => void;

/**
 * Start a channel's polling loop and handle incoming messages.
 * Runs indefinitely — launch as a background task.
 */
export async function startChannelPolling(channel: Channel, log: LogFn): Promise<void> {
  log(`${channel.name}: polling started`);

  await channel.startPolling(async (msg: ChannelMessage) => {
    log(`${channel.name}: received message from ${msg.from}: "${msg.text.slice(0, 80)}"`);

    try {
      await handleIncomingMessage(channel, msg, log);
    } catch (e) {
      log(`${channel.name}: error handling message — ${e}`);
    }
  });
}

/**
 * Send a notification to all configured channels.
 * Maps the sent message to the given thread so replies route correctly.
 */
export async function notifyAllChannels(
  channels: Channel[],
  text: string,
  threadId: string,
  log: LogFn,
): Promise<void> {
  for (const channel of channels) {
    try {
      const msgId = await channel.sendNotification(text);
      await mapChannelMessageToThread(channel.name, msgId, threadId);
    } catch (e) {
      log(`${channel.name}: notification failed — ${e}`);
    }
  }
}

// ─── Internal ──────────────────────────────────────────────────────────────

async function handleIncomingMessage(
  channel: Channel,
  msg: ChannelMessage,
  log: LogFn,
): Promise<void> {
  const config = loadConfig();

  // 1. Resolve thread — check reply context first, then persistent thread
  let threadId: string | null = null;

  if (msg.replyToMessageId) {
    threadId = await getThreadForChannelMessage(channel.name, msg.replyToMessageId);
  }

  if (!threadId) {
    threadId = await getPersistentThreadId(channel.name);
  }

  if (!threadId) {
    threadId = await createThread(`${channel.name} chat`, { type: "chat" });
    await setPersistentThreadId(channel.name, threadId);
    log(`${channel.name}: created persistent chat thread ${threadId}`);
  }

  // 2. Store user message
  await addMessage(threadId, "user", msg.text);

  // 3. Build conversation history
  const history = await getMessages(threadId, 50);
  const priorMessages = history
    .filter((m) => m.role === "user" || m.role === "assistant")
    .slice(0, -1);

  const conversationHistory = priorMessages.length > 0
    ? priorMessages.map((m) => `${m.role === "user" ? "Human" : "Assistant"}: ${m.content}`).join("\n\n")
    : "";

  // 4. Show typing indicator
  channel.sendTypingIndicator().catch(() => {});

  // 5. Run agent — only text output, no tool call traces
  await finishThread(threadId, "running");
  const runner = new InProcessRunner(config);

  let agentOutput = "";
  try {
    const result = await runner.run(msg.text, undefined, (chunk: string, type: "text" | "tool") => {
      if (type === "text") agentOutput += chunk;
    }, { threadId, conversationHistory });

    agentOutput = result.output || agentOutput;
    await finishThread(threadId, result.exitCode === 0 ? "done" : "error");

    if (!agentOutput.trim()) {
      agentOutput = "I processed your message but had no text response.";
    }
  } catch (e) {
    log(`${channel.name}: agent error — ${e}`);
    await finishThread(threadId, "error");
    agentOutput = "Sorry, I encountered an error processing your message.";
  }

  // 6. Send response back as a reply
  try {
    const replyMsgId = await channel.sendReply(agentOutput, msg.id);
    await mapChannelMessageToThread(channel.name, replyMsgId, threadId);
  } catch (e) {
    log(`${channel.name}: failed to send response — ${e}`);
  }
}
