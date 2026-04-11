/**
 * Channel interface — abstraction for notification + bidirectional chat channels.
 *
 * Each channel (Telegram, Slack, Discord, etc.) implements this interface.
 * The daemon uses it to:
 *   1. Send workflow notifications
 *   2. Poll for incoming messages
 *   3. Send agent responses back
 *
 * Adding a new channel = implement Channel + register in channels/index.ts
 */

export interface ChannelMessage {
  /** Channel-specific message identifier */
  id: string;
  /** The text content of the message */
  text: string;
  /** Who sent it (channel-specific user ID or name) */
  from: string;
  /** If this is a reply, the ID of the message being replied to */
  replyToMessageId?: string;
}

export interface Channel {
  /** Unique channel name (e.g. "telegram", "slack") */
  readonly name: string;

  /** Whether this channel is configured and ready to use */
  isConfigured(): boolean;

  /**
   * Send a notification message (e.g. workflow output).
   * Returns the channel-specific message ID for reply threading.
   */
  sendNotification(text: string): Promise<string>;

  /**
   * Send a reply to a specific message.
   * Returns the channel-specific message ID.
   */
  sendReply(text: string, replyToMessageId: string): Promise<string>;

  /**
   * Show a "typing" indicator to the user.
   * No-op if the channel doesn't support it.
   */
  sendTypingIndicator(): Promise<void>;

  /**
   * Start polling for incoming messages.
   * Calls `onMessage` for each new message received.
   * Runs indefinitely — caller should launch as a background task.
   */
  startPolling(onMessage: (msg: ChannelMessage) => Promise<void>): Promise<void>;
}
