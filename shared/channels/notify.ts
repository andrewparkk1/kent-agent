/**
 * Channel notification helpers — used by both daemon and web API.
 * Separated from index.ts to avoid pulling in DB deps for tests.
 */
import type { Channel } from "./types.ts";
import { mapChannelMessageToThread } from "@shared/channel-state.ts";

type LogFn = (message: string) => void;

/** Format a workflow run result for notification. */
export function formatWorkflowNotification(workflowName: string, success: boolean, output: string): string {
  const status = success ? "completed" : "failed";
  const header = `**${workflowName}** — ${status}`;
  return output.trim()
    ? `${header}\n\n${output.trim()}`
    : `${header}\n\n(no output)`;
}

/**
 * Send a notification to all configured channels.
 * Maps the sent messages to the given thread so replies route correctly.
 */
export async function notifyAllChannels(
  channels: Channel[],
  text: string,
  threadId: string,
  log: LogFn,
): Promise<void> {
  for (const channel of channels) {
    try {
      const results = await channel.sendNotification(text);
      for (const { messageId } of results) {
        await mapChannelMessageToThread(channel.name, messageId, threadId);
      }
    } catch (e) {
      log(`${channel.name}: notification failed — ${e}`);
    }
  }
}
