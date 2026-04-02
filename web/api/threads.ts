/** GET /api/threads — list recent chat threads. */
/** GET /api/threads/:id/messages — get messages for a thread. */
/** DELETE /api/threads/:id — delete a thread and its messages. */
import { getDb } from "../../shared/db/connection.ts";
import { getMessages, getThread } from "../../shared/db/threads.ts";

export async function handleThreads() {
  const threads = await getDb()
    .selectFrom("threads")
    .orderBy("last_message_at", "desc")
    .limit(50)
    .selectAll()
    .execute();
  return Response.json({ threads });
}

export async function handleThreadMessages(req: Request) {
  const threadId = (req as any).params?.id || new URL(req.url).pathname.split("/")[3];
  if (!threadId) {
    return Response.json({ error: "Thread ID required" }, { status: 400 });
  }
  const thread = await getThread(threadId);
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

export async function handleDeleteThread(req: Request) {
  const threadId = extractThreadId(req);
  if (!threadId) {
    return Response.json({ error: "Thread ID required" }, { status: 400 });
  }
  const db = getDb();
  await db.deleteFrom("messages").where("thread_id", "=", threadId).execute();
  await db.deleteFrom("threads").where("id", "=", threadId).execute();
  return Response.json({ ok: true });
}
