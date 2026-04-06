/** GET /api/threads — list recent chat threads. */
/** GET /api/threads/:id/messages — get messages for a thread. */
/** DELETE /api/threads/:id — delete a thread and its messages. */
import { getDb } from "../../shared/db/connection.ts";
import { getMessages, getThread } from "../../shared/db/threads.ts";

export async function handleThreads() {
  const db = getDb();
  const threads = await db
    .selectFrom("threads")
    .leftJoin("workflows", "workflows.id", "threads.workflow_id")
    .where((eb) =>
      eb.exists(
        eb.selectFrom("messages").whereRef("messages.thread_id", "=", "threads.id").select("messages.id").limit(1)
      )
    )
    .orderBy("threads.last_message_at", "desc")
    .limit(50)
    .select([
      "threads.id",
      "threads.title",
      "threads.type",
      "threads.workflow_id",
      "threads.status",
      "threads.started_at",
      "threads.finished_at",
      "threads.created_at",
      "threads.last_message_at",
      "workflows.name as workflow_name",
    ])
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

  // Resolve workflow name if this is a workflow thread
  let workflowName: string | null = null;
  if (thread?.workflow_id) {
    const wf = await getDb()
      .selectFrom("workflows")
      .where("id", "=", thread.workflow_id)
      .select("name")
      .executeTakeFirst();
    workflowName = wf?.name ?? null;
  }

  return Response.json({
    messages,
    thread: thread ? { type: thread.type, status: thread.status, workflow_name: workflowName } : null,
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
