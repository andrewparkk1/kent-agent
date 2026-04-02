/** Threads and messages — conversation threads with the agent. */
import { sql } from "kysely";
import { getDb } from "./connection.ts";
import type { Thread, Message } from "./schema.ts";

export type { Thread, Message };

// ─── Threads ────────────────────────────────────────────────────────────────

export async function createThread(title?: string, opts?: {
  type?: "chat" | "workflow";
  workflow_id?: string;
}): Promise<string> {
  const id = crypto.randomUUID();
  const type = opts?.type ?? "chat";
  const now = Math.floor(Date.now() / 1000);

  await getDb()
    .insertInto("threads")
    .values({
      id,
      title: title ?? null,
      type,
      workflow_id: opts?.workflow_id ?? null,
      status: type === "workflow" ? "running" : null,
      started_at: type === "workflow" ? now : null,
    })
    .execute();

  return id;
}

export async function finishThread(id: string, status: "done" | "error" | "running"): Promise<void> {
  const updates: Record<string, any> = { status };
  if (status === "running") {
    updates.started_at = sql`unixepoch()`;
  } else {
    updates.finished_at = sql`unixepoch()`;
  }
  await getDb()
    .updateTable("threads")
    .set(updates)
    .where("id", "=", id)
    .execute();
}

export async function getRecentThreads(limit = 10, type?: "chat" | "workflow"): Promise<Thread[]> {
  let query = getDb()
    .selectFrom("threads")
    .orderBy("last_message_at", "desc")
    .limit(limit)
    .selectAll();

  if (type) query = query.where("type", "=", type);
  return query.execute();
}

export async function getWorkflowRuns(workflowId: string, limit = 50): Promise<Thread[]> {
  return getDb()
    .selectFrom("threads")
    .where("workflow_id", "=", workflowId)
    .orderBy("started_at", "desc")
    .limit(limit)
    .selectAll()
    .execute();
}

export async function getThread(id: string): Promise<Thread | undefined> {
  return getDb()
    .selectFrom("threads")
    .where("id", "=", id)
    .selectAll()
    .executeTakeFirst();
}

// ─── Messages ───────────────────────────────────────────────────────────────

export async function addMessage(
  threadId: string,
  role: "user" | "assistant" | "system" | "tool",
  content: string,
  metadata?: Record<string, any>,
): Promise<number> {
  const result = await getDb()
    .insertInto("messages")
    .values({
      thread_id: threadId,
      role,
      content,
      metadata: metadata ? JSON.stringify(metadata) : null,
    })
    .returning("id")
    .executeTakeFirstOrThrow();

  await getDb()
    .updateTable("threads")
    .set({ last_message_at: sql`unixepoch()` })
    .where("id", "=", threadId)
    .execute();

  return Number(result.id);
}

export async function getMessages(threadId: string, limit = 200): Promise<Message[]> {
  return getDb()
    .selectFrom("messages")
    .where("thread_id", "=", threadId)
    .orderBy("created_at", "asc")
    .limit(limit)
    .selectAll()
    .execute();
}
