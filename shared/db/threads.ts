/** Threads and messages — conversation threads with the agent. */
import { getDb } from "./connection.ts";

// ─── Threads ─────────────────────────────────────────────────────────────────

export interface DbThread {
  id: string;
  title: string | null;
  type: "chat" | "workflow";
  workflow_id: string | null;
  status: "running" | "done" | "error" | null;
  started_at: number | null;
  finished_at: number | null;
  created_at: number;
  last_message_at: number;
}

export function createThread(title?: string, opts?: {
  type?: "chat" | "workflow";
  workflow_id?: string;
}): string {
  const id = crypto.randomUUID();
  const type = opts?.type ?? "chat";
  const now = Math.floor(Date.now() / 1000);
  getDb()
    .prepare(`
      INSERT INTO threads (id, title, type, workflow_id, status, started_at)
      VALUES ($id, $title, $type, $wid, $status, $started_at)
    `)
    .run({
      $id: id,
      $title: title ?? null,
      $type: type,
      $wid: opts?.workflow_id ?? null,
      $status: type === "workflow" ? "running" : null,
      $started_at: type === "workflow" ? now : null,
    });
  return id;
}

export function finishThread(id: string, status: "done" | "error"): void {
  getDb()
    .prepare("UPDATE threads SET status = $status, finished_at = unixepoch() WHERE id = $id")
    .run({ $id: id, $status: status });
}

export function getRecentThreads(limit = 10, type?: "chat" | "workflow"): DbThread[] {
  if (type) {
    return getDb()
      .prepare("SELECT * FROM threads WHERE type = $type ORDER BY last_message_at DESC LIMIT $limit")
      .all({ $type: type, $limit: limit }) as DbThread[];
  }
  return getDb()
    .prepare("SELECT * FROM threads ORDER BY last_message_at DESC LIMIT $limit")
    .all({ $limit: limit }) as DbThread[];
}

export function getWorkflowRuns(workflowId: string, limit = 50): DbThread[] {
  return getDb()
    .prepare("SELECT * FROM threads WHERE workflow_id = $wid ORDER BY started_at DESC LIMIT $limit")
    .all({ $wid: workflowId, $limit: limit }) as DbThread[];
}

export function getThread(id: string): DbThread | null {
  return getDb()
    .prepare("SELECT * FROM threads WHERE id = $id")
    .get({ $id: id }) as DbThread | null;
}

// ─── Messages ────────────────────────────────────────────────────────────────

export interface DbMessage {
  id: number;
  thread_id: string;
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  metadata: string | null;
  created_at: number;
}

export function addMessage(
  threadId: string,
  role: "user" | "assistant" | "system" | "tool",
  content: string,
  metadata?: Record<string, any>,
): number {
  const db = getDb();
  const result = db
    .prepare("INSERT INTO messages (thread_id, role, content, metadata) VALUES ($thread_id, $role, $content, $metadata)")
    .run({
      $thread_id: threadId,
      $role: role,
      $content: content,
      $metadata: metadata ? JSON.stringify(metadata) : null,
    });

  db.prepare("UPDATE threads SET last_message_at = unixepoch() WHERE id = $id")
    .run({ $id: threadId });

  return Number(result.lastInsertRowid);
}

export function getMessages(threadId: string, limit = 200): DbMessage[] {
  return getDb()
    .prepare("SELECT * FROM messages WHERE thread_id = $thread_id ORDER BY created_at ASC LIMIT $limit")
    .all({ $thread_id: threadId, $limit: limit }) as DbMessage[];
}
