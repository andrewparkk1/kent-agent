/**
 * Channel ↔ thread mapping — stores which channel messages map to which Kent threads.
 * Uses the kv table. All keys are namespaced by channel name so multiple channels
 * can coexist without conflicts.
 */
import { getDb } from "./db/connection.ts";

// Key patterns:
//   ch:<channel>:msg:<messageId>     → threadId
//   ch:<channel>:thread:<threadId>   → messageId
//   ch:<channel>:persistent_thread   → threadId

/** Store a bidirectional mapping between a channel message and a Kent thread. */
export async function mapChannelMessageToThread(
  channelName: string,
  messageId: string,
  threadId: string,
): Promise<void> {
  const db = getDb();
  const msgKey = `ch:${channelName}:msg:${messageId}`;
  const threadKey = `ch:${channelName}:thread:${threadId}`;

  await db
    .insertInto("kv")
    .values({ key: msgKey, value: threadId })
    .onConflict((oc) => oc.column("key").doUpdateSet({ value: threadId }))
    .execute();

  await db
    .insertInto("kv")
    .values({ key: threadKey, value: messageId })
    .onConflict((oc) => oc.column("key").doUpdateSet({ value: messageId }))
    .execute();
}

/** Look up which Kent thread a channel message belongs to. */
export async function getThreadForChannelMessage(
  channelName: string,
  messageId: string,
): Promise<string | null> {
  const db = getDb();
  const row = await db
    .selectFrom("kv")
    .where("key", "=", `ch:${channelName}:msg:${messageId}`)
    .select("value")
    .executeTakeFirst();
  return row?.value ?? null;
}

/** Get the persistent chat thread ID for a channel. */
export async function getPersistentThreadId(channelName: string): Promise<string | null> {
  const db = getDb();
  const row = await db
    .selectFrom("kv")
    .where("key", "=", `ch:${channelName}:persistent_thread`)
    .select("value")
    .executeTakeFirst();
  return row?.value ?? null;
}

/** Set the persistent chat thread ID for a channel. */
export async function setPersistentThreadId(channelName: string, threadId: string): Promise<void> {
  const db = getDb();
  await db
    .insertInto("kv")
    .values({ key: `ch:${channelName}:persistent_thread`, value: threadId })
    .onConflict((oc) => oc.column("key").doUpdateSet({ value: threadId }))
    .execute();
}
