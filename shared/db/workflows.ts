/** Workflows — scheduled and manual agent workflows. */
import { getDb } from "./connection.ts";

export interface DbWorkflow {
  id: string;
  name: string;
  description: string;
  prompt: string;
  cron_schedule: string | null;
  type: "cron" | "manual" | "event";
  source: "default" | "user" | "suggested";
  enabled: number;
  last_run_at: number | null;
  next_run_at: number | null;
  created_at: number;
  updated_at: number;
}

export function createWorkflow(opts: {
  name: string;
  prompt: string;
  description?: string;
  cron_schedule?: string;
  type?: "cron" | "manual" | "event";
  source?: "default" | "user" | "suggested";
}): string {
  const id = crypto.randomUUID();
  const type = opts.type ?? (opts.cron_schedule ? "cron" : "manual");
  getDb()
    .prepare(`
      INSERT INTO workflows (id, name, description, prompt, cron_schedule, type, source)
      VALUES ($id, $name, $description, $prompt, $cron_schedule, $type, $source)
    `)
    .run({
      $id: id,
      $name: opts.name,
      $description: opts.description ?? "",
      $prompt: opts.prompt,
      $cron_schedule: opts.cron_schedule ?? null,
      $type: type,
      $source: opts.source ?? "user",
    });
  return id;
}

export function listWorkflows(): DbWorkflow[] {
  return getDb()
    .prepare("SELECT * FROM workflows ORDER BY created_at DESC")
    .all() as DbWorkflow[];
}

export function getWorkflow(idOrName: string): DbWorkflow | null {
  return (
    getDb()
      .prepare("SELECT * FROM workflows WHERE id = $v OR name = $v")
      .get({ $v: idOrName }) as DbWorkflow | null
  );
}

export function updateWorkflow(
  id: string,
  fields: Partial<Pick<DbWorkflow, "name" | "description" | "prompt" | "cron_schedule" | "enabled" | "last_run_at" | "next_run_at">>,
): void {
  const sets: string[] = [];
  const params: Record<string, any> = { $id: id };

  for (const [key, value] of Object.entries(fields)) {
    sets.push(`${key} = $${key}`);
    params[`$${key}`] = value;
  }
  sets.push("updated_at = unixepoch()");

  if (sets.length === 1) return; // only updated_at, no real changes

  getDb()
    .prepare(`UPDATE workflows SET ${sets.join(", ")} WHERE id = $id`)
    .run(params);
}

export function deleteWorkflow(idOrName: string): boolean {
  const wf = getWorkflow(idOrName);
  if (!wf) return false;
  getDb().prepare("DELETE FROM workflows WHERE id = $id").run({ $id: wf.id });
  return true;
}

export function getDueWorkflows(now: number): DbWorkflow[] {
  return getDb()
    .prepare(`
      SELECT * FROM workflows
      WHERE enabled = 1 AND cron_schedule IS NOT NULL
    `)
    .all() as DbWorkflow[];
}
