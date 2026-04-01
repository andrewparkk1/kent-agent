/** GET /api/threads — list recent chat threads. */
/** GET /api/threads/:id/messages — get messages for a thread. */
/** DELETE /api/threads/:id — delete a thread and its messages. */
import { getDb, getMessages } from "../../shared/db.ts";

export function handleThreads() {
  const db = getDb();
  const threads = db
    .prepare("SELECT * FROM threads ORDER BY last_message_at DESC LIMIT 50")
    .all() as any[];
  return Response.json({ threads });
}

export function handleThreadMessages(req: Request) {
  // Bun route params are on req.params when using "/api/threads/:id/messages"
  const threadId = (req as any).params?.id;
  if (!threadId) {
    // Fallback: parse from URL
    const parts = new URL(req.url).pathname.split("/");
    const fallbackId = parts[3];
    if (!fallbackId) {
      return Response.json({ error: "Thread ID required" }, { status: 400 });
    }
    const messages = getMessages(fallbackId, 100);
    return Response.json({ messages });
  }
  const messages = getMessages(threadId, 100);
  return Response.json({ messages });
}

function extractThreadId(req: Request): string | null {
  const id = (req as any).params?.id;
  if (id) return id;
  const parts = new URL(req.url).pathname.split("/");
  return parts[3] || null;
}

export function handleDeleteThread(req: Request) {
  const threadId = extractThreadId(req);
  if (!threadId) {
    return Response.json({ error: "Thread ID required" }, { status: 400 });
  }
  const db = getDb();
  db.prepare("DELETE FROM messages WHERE thread_id = $id").run({ $id: threadId });
  db.prepare("DELETE FROM threads WHERE id = $id").run({ $id: threadId });
  return Response.json({ ok: true });
}
