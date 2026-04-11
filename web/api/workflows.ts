/** GET /api/workflows — list workflows with run stats. */
/** GET /api/activity — recent workflow runs. */
/** POST /api/workflow/run — trigger a workflow run with streaming output. */
import { getDb } from "../../shared/db/connection.ts";
import { getWorkflow, updateWorkflow, deleteWorkflow, archiveWorkflow, unarchiveWorkflow } from "../../shared/db/workflows.ts";
import { createThread, finishThread, addMessage } from "../../shared/db/threads.ts";
import { loadConfig } from "../../shared/config.ts";
import { sendLongMessage, mapMessageToThread } from "../../shared/telegram.ts";
import { resolve } from "node:path";
import { sql } from "kysely";

export async function handleWorkflows() {
  const db = getDb();

  const workflows = await db
    .selectFrom("workflows")
    .orderBy("updated_at", "desc")
    .selectAll()
    .execute();

  const runs = await db
    .selectFrom("threads")
    .where("type", "=", "workflow")
    .where("workflow_id", "is not", null)
    .groupBy("workflow_id")
    .select([
      "workflow_id",
      sql<number>`COUNT(*)`.as("run_count"),
      sql<number>`MAX(started_at)`.as("last_run_at"),
    ])
    .execute();

  const runMap: Record<string, (typeof runs)[number]> = {};
  for (const r of runs) runMap[r.workflow_id!] = r;

  const totalRuns = await db
    .selectFrom("threads")
    .where("type", "=", "workflow")
    .select(sql<number>`COUNT(*)`.as("count"))
    .executeTakeFirst();

  return Response.json({
    workflows: workflows.map((w) => ({
      ...w,
      enabled: !!w.enabled,
      runCount: runMap[w.id]?.run_count || 0,
      lastRunAt: w.last_run_at || runMap[w.id]?.last_run_at || null,
    })),
    totalRuns: totalRuns?.count || 0,
  });
}

export async function handleWorkflowDetail(req: Request) {
  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  if (!id) return Response.json({ error: "id required" }, { status: 400 });

  const workflow = await getWorkflow(id);
  if (!workflow) return Response.json({ error: "not found" }, { status: 404 });

  const db = getDb();

  const runs = await db
    .selectFrom("threads")
    .where("type", "=", "workflow")
    .where("workflow_id", "=", workflow.id)
    .orderBy("started_at", "desc")
    .limit(50)
    .selectAll()
    .execute();

  // Get last assistant message for each run
  const enriched = await Promise.all(
    runs.map(async (r) => {
      const lastMsg = await db
        .selectFrom("messages")
        .where("thread_id", "=", r.id)
        .where("role", "=", "assistant")
        .orderBy("created_at", "desc")
        .limit(1)
        .select("content")
        .executeTakeFirst();
      return { ...r, output: lastMsg?.content || null };
    })
  );

  return Response.json({
    workflow: { ...workflow, enabled: !!workflow.enabled },
    runs: enriched,
  });
}

export async function handleWorkflowRun(req: Request) {
  const body = await req.json();
  const { id } = body as { id: string };
  if (!id) return Response.json({ error: "id required" }, { status: 400 });

  const workflow = await getWorkflow(id);
  if (!workflow) return Response.json({ error: "not found" }, { status: 404 });

  const config = loadConfig();
  const threadId = await createThread(`workflow: ${workflow.name}`, { type: "workflow", workflow_id: workflow.id });
  await updateWorkflow(workflow.id, { last_run_at: Math.floor(Date.now() / 1000) });

  const projectRoot = resolve(import.meta.dir, "../..");
  const agentPath = resolve(projectRoot, "agent", "agent.ts");
  const bunPath = process.execPath || "bun";

  const env: Record<string, string> = {
    ...process.env as Record<string, string>,
    ANTHROPIC_API_KEY: config.keys.anthropic || process.env.ANTHROPIC_API_KEY || "",
    RUNNER: "workflow",
    THREAD_ID: threadId,
    PROMPT: workflow.prompt,
    MODEL: config.agent.default_model,
  };

  const proc = Bun.spawn([bunPath, "run", agentPath], {
    env,
    stdout: "pipe",
    stderr: "pipe",
    cwd: projectRoot,
  });

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      controller.enqueue(encoder.encode(`data: ${JSON.stringify({ threadId, workflowId: workflow.id, workflowName: workflow.name })}\n\n`));

      let fullOutput = "";
      let stderrOutput = "";

      // Stream stdout (agent text)
      const stdoutReader = (async () => {
        const reader = proc.stdout.getReader();
        const decoder = new TextDecoder();
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const chunk = decoder.decode(value, { stream: true });
          fullOutput += chunk;
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ delta: chunk })}\n\n`));
        }
      })();

      // Capture stderr (tool calls)
      const stderrReader = (async () => {
        const reader = proc.stderr.getReader();
        const decoder = new TextDecoder();
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const chunk = decoder.decode(value, { stream: true });
          stderrOutput += chunk;
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ tool: chunk })}\n\n`));
        }
      })();

      try {
        await Promise.all([stdoutReader, stderrReader]);
        await proc.exited;
      } catch {
        // Stream or process error
      }

      // Always finalize the thread, even if the stream was cancelled
      const success = proc.exitCode === 0 || proc.exitCode === null;
      try {
        await finishThread(threadId, success ? "done" : "error");
      } catch {}

      // Send Telegram notification
      try {
        const tgConfig = loadConfig().telegram;
        if (tgConfig.bot_token && tgConfig.chat_id) {
          const status = success ? "completed" : "failed";
          const body = fullOutput.trim()
            ? `**${workflow.name}** — ${status}\n\n${fullOutput.trim()}`
            : `**${workflow.name}** — ${status}\n\n(no output)`;
          sendLongMessage(tgConfig.bot_token, tgConfig.chat_id, body)
            .then((msgId) => mapMessageToThread(msgId, threadId))
            .catch(() => {});
        }
      } catch {}

      try {
        // If agent produced no output but had stderr, surface the error
        if (!fullOutput.trim() && stderrOutput.trim()) {
          const errMsg = stderrOutput.includes("401") || stderrOutput.includes("auth") || stderrOutput.includes("API key")
            ? "Authentication failed. Check your Anthropic API key in Settings."
            : `Agent error: ${stderrOutput.slice(0, 500)}`;
          await addMessage(threadId, "assistant", errMsg);
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ delta: errMsg })}\n\n`));
        } else if (!success && !fullOutput.trim()) {
          const errMsg = "Agent exited with an error. Check your API key and try again.";
          await addMessage(threadId, "assistant", errMsg);
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ delta: errMsg })}\n\n`));
        }

        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ status: success ? "done" : "error" })}\n\n`));
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      } catch {
        // Client disconnected, that's fine — run is already finalized
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
    },
  });
}

export async function handleWorkflowToggle(req: Request) {
  const body = await req.json();
  const { id } = body as { id: string };
  if (!id) return Response.json({ error: "id required" }, { status: 400 });

  const workflow = await getWorkflow(id);
  if (!workflow) return Response.json({ error: "not found" }, { status: 404 });

  const newEnabled = !workflow.enabled;
  const updates: Parameters<typeof updateWorkflow>[1] = { enabled: newEnabled ? 1 : 0 };
  // Promote suggested → user when enabling
  if (newEnabled && workflow.source === "suggested") {
    updates.source = "user";
  }
  await updateWorkflow(workflow.id, updates);
  return Response.json({ enabled: newEnabled });
}

export async function handleWorkflowArchive(req: Request) {
  const body = await req.json();
  const { id } = body as { id: string };
  if (!id) return Response.json({ error: "id required" }, { status: 400 });
  const ok = await archiveWorkflow(id);
  if (!ok) return Response.json({ error: "not found" }, { status: 404 });
  return Response.json({ ok: true });
}

export async function handleWorkflowUnarchive(req: Request) {
  const body = await req.json();
  const { id } = body as { id: string };
  if (!id) return Response.json({ error: "id required" }, { status: 400 });
  const ok = await unarchiveWorkflow(id);
  if (!ok) return Response.json({ error: "not found" }, { status: 404 });
  return Response.json({ ok: true });
}

export async function handleWorkflowDelete(req: Request) {
  const body = await req.json();
  const { id } = body as { id: string };
  if (!id) return Response.json({ error: "id required" }, { status: 400 });

  const deleted = await deleteWorkflow(id);
  if (!deleted) return Response.json({ error: "not found" }, { status: 404 });
  return Response.json({ ok: true });
}

const BRIEF_WORKFLOW_NAMES = ["morning-briefing", "evening-recap"] as const;
const BRIEF_THREAD_TITLES = ["workflow: morning-briefing", "workflow: evening-recap"] as const;

/** Helper: get last assistant message for a thread */
async function getLastAssistantContent(threadId: string): Promise<string | null> {
  const msg = await getDb()
    .selectFrom("messages")
    .where("thread_id", "=", threadId)
    .where("role", "=", "assistant")
    .orderBy("created_at", "desc")
    .limit(1)
    .select("content")
    .executeTakeFirst();
  return msg?.content ?? null;
}

export async function handleBrief(req: Request) {
  const url = new URL(req.url);
  const dateParam = url.searchParams.get("date"); // YYYY-MM-DD
  const db = getDb();

  // Calculate day boundaries (local timezone)
  let dayStart: number;
  let dayEnd: number;
  if (dateParam) {
    const d = new Date(dateParam + "T00:00:00");
    dayStart = Math.floor(d.getTime() / 1000);
    dayEnd = dayStart + 86400;
  } else {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    dayStart = Math.floor(todayStart.getTime() / 1000);
    dayEnd = dayStart + 86400;
  }

  // Get all briefs for this day
  const threads = await db
    .selectFrom("threads as t")
    .leftJoin("workflows as w", "w.id", "t.workflow_id")
    .where("t.type", "=", "workflow")
    .where("t.status", "=", "done")
    .where("t.started_at", ">=", dayStart)
    .where("t.started_at", "<", dayEnd)
    .where((eb) =>
      eb.or([
        eb("w.name", "in", [...BRIEF_WORKFLOW_NAMES]),
        eb("t.title", "in", [...BRIEF_THREAD_TITLES]),
      ])
    )
    .orderBy("t.started_at", "desc")
    .select([
      "t.id", "t.title", "t.type", "t.workflow_id", "t.status",
      "t.started_at", "t.finished_at", "t.created_at", "t.last_message_at",
      sql<string>`COALESCE(w.name, REPLACE(t.title, 'workflow: ', ''))`.as("workflow_name"),
      sql<string>`COALESCE(w.description, '')`.as("workflow_description"),
    ])
    .execute();

  // Get output for each brief
  const briefs = (await Promise.all(
    threads.map(async (thread) => {
      const output = await getLastAssistantContent(thread.id);
      return output ? { ...thread, output } : null;
    })
  )).filter(Boolean) as Array<(typeof threads)[number] & { output: string }>;

  // If no briefs for requested day and no date specified, find the most recent brief
  if (briefs.length === 0 && !dateParam) {
    const latest = await db
      .selectFrom("threads as t")
      .leftJoin("workflows as w", "w.id", "t.workflow_id")
      .where("t.type", "=", "workflow")
      .where("t.status", "=", "done")
      .where((eb) =>
        eb.or([
          eb("w.name", "in", [...BRIEF_WORKFLOW_NAMES]),
          eb("t.title", "in", [...BRIEF_THREAD_TITLES]),
        ])
      )
      .orderBy("t.started_at", "desc")
      .limit(1)
      .select([
        "t.id", "t.title", "t.type", "t.workflow_id", "t.status",
        "t.started_at", "t.finished_at", "t.created_at", "t.last_message_at",
        sql<string>`COALESCE(w.name, REPLACE(t.title, 'workflow: ', ''))`.as("workflow_name"),
        sql<string>`COALESCE(w.description, '')`.as("workflow_description"),
      ])
      .executeTakeFirst();

    if (latest) {
      const output = await getLastAssistantContent(latest.id);
      if (output) {
        briefs.push({ ...latest, output });
      }
    }
  }

  // Get all dates that have briefs (for navigation) — needs raw sql for date() function
  const dates = await db
    .selectFrom("threads as t")
    .leftJoin("workflows as w", "w.id", "t.workflow_id")
    .where("t.type", "=", "workflow")
    .where("t.status", "=", "done")
    .where((eb) =>
      eb.or([
        eb("w.name", "in", [...BRIEF_WORKFLOW_NAMES]),
        eb("t.title", "in", [...BRIEF_THREAD_TITLES]),
      ])
    )
    .select(sql<string>`DISTINCT date(t.started_at, 'unixepoch', 'localtime')`.as("date"))
    .orderBy(sql`date`, "desc")
    .limit(90)
    .execute();

  return Response.json({
    briefs,
    dates: dates.map((d) => d.date),
  });
}

export async function handleActivity() {
  const db = getDb();

  const lastSeenRow = await db
    .selectFrom("kv")
    .where("key", "=", "activity_last_seen_at")
    .select("value")
    .executeTakeFirst();
  const lastSeenAt = lastSeenRow ? Number(lastSeenRow.value) : 0;

  const runs = await db
    .selectFrom("threads as t")
    .leftJoin("workflows as w", "w.id", "t.workflow_id")
    .where("t.type", "=", "workflow")
    .orderBy("t.started_at", "desc")
    .limit(100)
    .select([
      "t.id", "t.title", "t.type", "t.workflow_id", "t.status",
      "t.started_at", "t.finished_at", "t.created_at", "t.last_message_at",
      sql<string>`COALESCE(w.name, REPLACE(t.title, 'workflow: ', ''))`.as("workflow_name"),
    ])
    .execute();

  // Attach last assistant message as output preview
  const enriched = await Promise.all(
    runs.map(async (r) => {
      const output = await getLastAssistantContent(r.id);
      return { ...r, output, is_new: (r.started_at ?? 0) > lastSeenAt };
    })
  );

  return Response.json({ runs: enriched, last_seen_at: lastSeenAt });
}

export async function handleActivitySeen() {
  const db = getDb();
  const now = Math.floor(Date.now() / 1000);
  await db
    .insertInto("kv")
    .values({ key: "activity_last_seen_at", value: String(now) })
    .onConflict((oc) => oc.column("key").doUpdateSet({ value: String(now) }))
    .execute();
  return Response.json({ ok: true });
}

export async function handleUnreadCount() {
  const db = getDb();
  const lastSeenRow = await db
    .selectFrom("kv")
    .where("key", "=", "activity_last_seen_at")
    .select("value")
    .executeTakeFirst();
  const lastSeenAt = lastSeenRow ? Number(lastSeenRow.value) : 0;

  const result = await db
    .selectFrom("threads")
    .where("type", "=", "workflow")
    .where("started_at", ">", lastSeenAt)
    .select(sql<number>`COUNT(*)`.as("count"))
    .executeTakeFirst();

  return Response.json({ count: result?.count ?? 0 });
}
