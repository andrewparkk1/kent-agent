/** GET /api/workflows — list workflows with run stats. */
/** GET /api/activity — recent workflow runs. */
/** POST /api/workflow/run — trigger a workflow run with streaming output. */
import { getDb, createWorkflowRun, finishWorkflowRun, updateWorkflow } from "../../shared/db.ts";
import { loadConfig, KENT_DIR } from "../../shared/config.ts";
import { join, resolve } from "node:path";

export function handleWorkflows() {
  const db = getDb();
  const workflows = db
    .prepare("SELECT * FROM workflows ORDER BY updated_at DESC")
    .all() as any[];

  const runs = db
    .prepare(
      `SELECT workflow_id, COUNT(*) as run_count,
              MAX(started_at) as last_run_at,
              SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed_count
       FROM workflow_runs GROUP BY workflow_id`
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
    .prepare("SELECT * FROM workflow_runs WHERE workflow_id = ? ORDER BY started_at DESC LIMIT 50")
    .all(workflow.id) as any[];

  return Response.json({
    workflow: { ...workflow, enabled: !!workflow.enabled },
    runs,
  });
}

export function handleActivity() {
  const db = getDb();
  const runs = db
    .prepare(
      `SELECT r.*, w.name as workflow_name
       FROM workflow_runs r
       LEFT JOIN workflows w ON w.id = r.workflow_id
       ORDER BY r.started_at DESC
       LIMIT 100`
    )
    .all() as any[];

  return Response.json({ runs });
}
