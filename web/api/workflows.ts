/** GET /api/workflows — list workflows with run stats. */
/** GET /api/activity — recent workflow runs. */
/** POST /api/workflow/run — trigger a workflow run with streaming output. */
import { getDb, updateWorkflow, deleteWorkflow, createThread, finishThread } from "../../shared/db.ts";
import { loadConfig, KENT_DIR } from "../../shared/config.ts";
import { resolve } from "node:path";

export function handleWorkflows() {
  const db = getDb();
  const workflows = db
    .prepare("SELECT * FROM workflows ORDER BY updated_at DESC")
    .all() as any[];

  const runs = db
    .prepare(
      `SELECT workflow_id, COUNT(*) as run_count, MAX(started_at) as last_run_at
       FROM threads WHERE type = 'workflow' AND workflow_id IS NOT NULL
       GROUP BY workflow_id`
    )
    .all() as any[];

  const runMap: Record<string, any> = {};
  for (const r of runs) runMap[r.workflow_id] = r;

  return Response.json({
    workflows: workflows.map((w: any) => ({
      ...w,
      enabled: !!w.enabled,
      runCount: runMap[w.id]?.run_count || 0,
      lastRunAt: w.last_run_at || runMap[w.id]?.last_run_at || null,
    })),
  });
}

export function handleWorkflowDetail(req: Request) {
  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  if (!id) return Response.json({ error: "id required" }, { status: 400 });

  const db = getDb();
  const workflow = db.prepare("SELECT * FROM workflows WHERE id = ? OR name = ?").get(id, id) as any;
  if (!workflow) return Response.json({ error: "not found" }, { status: 404 });

  const runs = db
    .prepare("SELECT * FROM threads WHERE type = 'workflow' AND workflow_id = ? ORDER BY started_at DESC LIMIT 50")
    .all(workflow.id) as any[];

  return Response.json({
    workflow: { ...workflow, enabled: !!workflow.enabled },
    runs,
  });
}

export async function handleWorkflowRun(req: Request) {
  const body = await req.json();
  const { id } = body as { id: string };
  if (!id) return Response.json({ error: "id required" }, { status: 400 });

  const db = getDb();
  const workflow = db.prepare("SELECT * FROM workflows WHERE id = ? OR name = ?").get(id, id) as any;
  if (!workflow) return Response.json({ error: "not found" }, { status: 404 });

  const config = loadConfig();
  const threadId = createThread(`workflow: ${workflow.name}`, { type: "workflow", workflow_id: workflow.id });
  updateWorkflow(workflow.id, { last_run_at: Math.floor(Date.now() / 1000) });

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
    MAX_TURNS: String(config.agent.max_turns),
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
      try {
        finishThread(threadId, (proc.exitCode === 0 || proc.exitCode === null) ? "done" : "error");
      } catch {}

      try {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ status: proc.exitCode === 0 ? "done" : "error" })}\n\n`));
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

  const db = getDb();
  const workflow = db.prepare("SELECT * FROM workflows WHERE id = ? OR name = ?").get(id, id) as any;
  if (!workflow) return Response.json({ error: "not found" }, { status: 404 });

  const newEnabled = !workflow.enabled;
  updateWorkflow(workflow.id, { enabled: newEnabled ? 1 : 0 } as any);
  return Response.json({ enabled: newEnabled });
}

export async function handleWorkflowDelete(req: Request) {
  const body = await req.json();
  const { id } = body as { id: string };
  if (!id) return Response.json({ error: "id required" }, { status: 400 });

  const deleted = deleteWorkflow(id);
  if (!deleted) return Response.json({ error: "not found" }, { status: 404 });
  return Response.json({ ok: true });
}

export function handleBrief() {
  const db = getDb();
  // Get the latest completed workflow thread for morning-briefing or evening-recap
  const thread = db
    .prepare(
      `SELECT t.*, w.name as workflow_name, w.description as workflow_description
       FROM threads t
       JOIN workflows w ON w.id = t.workflow_id
       WHERE w.name IN ('morning-briefing', 'evening-recap')
         AND t.status = 'done'
       ORDER BY t.started_at DESC
       LIMIT 1`
    )
    .get() as any;

  if (!thread) return Response.json({ run: null });

  // Get the last assistant message as the output
  const lastMsg = db
    .prepare("SELECT content FROM messages WHERE thread_id = ? AND role = 'assistant' ORDER BY created_at DESC LIMIT 1")
    .get(thread.id) as any;

  return Response.json({
    run: {
      ...thread,
      output: lastMsg?.content || null,
    },
  });
}

export function handleActivity() {
  const db = getDb();
  const runs = db
    .prepare(
      `SELECT t.*, w.name as workflow_name
       FROM threads t
       LEFT JOIN workflows w ON w.id = t.workflow_id
       WHERE t.type = 'workflow'
       ORDER BY t.started_at DESC
       LIMIT 100`
    )
    .all() as any[];

  return Response.json({ runs });
}
