/** GET /api/threads — list recent chat threads. */
/** GET /api/threads/:id/messages — get messages for a thread. */
/** DELETE /api/threads/:id — delete a thread and its messages. */
import { getRawDb, getMessages } from "../../shared/db.ts";

export function handleThreads() {
  const db = getRawDb();
  const threads = db
    .prepare("SELECT * FROM threads ORDER BY last_message_at DESC LIMIT 50")
    .all() as any[];
  return Response.json({ threads });
}

export async function handleThreadMessages(req: Request) {
  const threadId = (req as any).params?.id || new URL(req.url).pathname.split("/")[3];
  if (!threadId) {
    return Response.json({ error: "Thread ID required" }, { status: 400 });
  }
  const db = getRawDb();
  const thread = db.prepare("SELECT type, status FROM threads WHERE id = ?").get(threadId) as any;
  const messages = await getMessages(threadId, 200);
  return Response.json({
    messages,
    thread: thread ? { type: thread.type, status: thread.status } : null,
  });
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
  const db = getRawDb();
  db.prepare("DELETE FROM messages WHERE thread_id = $id").run({ $id: threadId });
  db.prepare("DELETE FROM threads WHERE id = $id").run({ $id: threadId });
  return Response.json({ ok: true });
}
