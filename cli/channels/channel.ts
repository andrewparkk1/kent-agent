/**
 * Channel abstraction for Kent CLI.
 *
 * Channels do two things:
 *   1. RECEIVE — accept incoming messages, run them through the agent, send responses back
 *   2. NOTIFY  — push workflow results or other messages to the user
 */
export interface Channel {
  /** Human-readable channel name (e.g. "telegram") */
  name: string;

  /** Start listening for incoming messages */
  start(): Promise<void>;

  /** Gracefully shut down the channel */
  stop(): Promise<void>;

  /** Push a notification message to the user (e.g. workflow output) */
  notify(message: string, runId?: string): Promise<void>;
}

/**
 * Registry of available channel implementations.
 * Import and register new channels here.
 */
const channelRegistry = new Map<string, () => Promise<Channel>>();

export function registerChannel(
  name: string,
  factory: () => Promise<Channel>,
): void {
  channelRegistry.set(name, factory);
}

export async function getChannel(name: string): Promise<Channel> {
  const factory = channelRegistry.get(name);
  if (!factory) {
    const available = Array.from(channelRegistry.keys()).join(", ");
    throw new Error(
      `Unknown channel: "${name}". Available channels: ${available || "none"}`,
    );
  }
  return factory();
}

export function listChannelNames(): string[] {
  return Array.from(channelRegistry.keys());
}

/**
 * Broadcast a message to all registered channels.
 * Failures on individual channels are logged but don't block others.
 * Always prints to terminal as the baseline.
 */
export async function broadcastAll(message: string, runId?: string): Promise<void> {
  // Always print to terminal (the caller is running in CLI context)
  console.log("\n--- Workflow Output ---\n");
  console.log(message);

  // Fan out to all registered channels
  const channels = listChannelNames();
  const results = await Promise.allSettled(
    channels.map(async (name) => {
      try {
        const channel = await getChannel(name);
        await channel.notify(message, runId);
        console.log(`[broadcast] Sent to ${name}`);
      } catch (err) {
        console.error(
          `[broadcast] Failed to send to ${name}: ${err instanceof Error ? err.message : err}`,
        );
      }
    }),
  );
}

// ── Register built-in channels ───────────────────────────────────────────
registerChannel("telegram", async () => {
  const { TelegramChannel } = await import("./telegram.ts");
  return new TelegramChannel();
});
