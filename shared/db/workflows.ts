/** Workflows — scheduled and manual agent workflows. */
import { sql } from "kysely";
import { getDb } from "./connection.ts";
import type { Workflow } from "./schema.ts";

export type { Workflow };

export async function createWorkflow(opts: {
  name: string;
  prompt: string;
  description?: string;
  cron_schedule?: string;
  type?: "cron" | "manual" | "event";
  source?: "default" | "user" | "suggested";
}): Promise<string> {
  const id = crypto.randomUUID();
  await getDb()
    .insertInto("workflows")
    .values({
      id,
      name: opts.name,
      description: opts.description ?? "",
      prompt: opts.prompt,
      cron_schedule: opts.cron_schedule ?? null,
      type: opts.type ?? (opts.cron_schedule ? "cron" : "manual"),
      source: opts.source ?? "user",
    })
    .execute();
  return id;
}

export async function listWorkflows(): Promise<Workflow[]> {
  return getDb()
    .selectFrom("workflows")
    .orderBy("created_at", "desc")
    .selectAll()
    .execute();
}

export async function getWorkflow(idOrName: string): Promise<Workflow | undefined> {
  return getDb()
    .selectFrom("workflows")
    .where((eb) => eb.or([eb("id", "=", idOrName), eb("name", "=", idOrName)]))
    .selectAll()
    .executeTakeFirst();
}

export async function updateWorkflow(
  id: string,
  fields: Partial<Pick<Workflow, "name" | "description" | "prompt" | "cron_schedule" | "enabled" | "last_run_at" | "next_run_at">>,
): Promise<void> {
  if (Object.keys(fields).length === 0) return;
  await getDb()
    .updateTable("workflows")
    .set({ ...fields, updated_at: sql`unixepoch()` })
    .where("id", "=", id)
    .execute();
}

export async function deleteWorkflow(idOrName: string): Promise<boolean> {
  const wf = await getWorkflow(idOrName);
  if (!wf) return false;
  await getDb().deleteFrom("workflows").where("id", "=", wf.id).execute();
  return true;
}

export async function archiveWorkflow(idOrName: string): Promise<boolean> {
  const wf = await getWorkflow(idOrName);
  if (!wf) return false;
  await getDb()
    .updateTable("workflows")
    .set({ is_archived: 1, enabled: 0, updated_at: sql`unixepoch()` })
    .where("id", "=", wf.id)
    .execute();
  return true;
}

export async function unarchiveWorkflow(idOrName: string): Promise<boolean> {
  const wf = await getWorkflow(idOrName);
  if (!wf) return false;
  await getDb()
    .updateTable("workflows")
    .set({ is_archived: 0, updated_at: sql`unixepoch()` })
    .where("id", "=", wf.id)
    .execute();
  return true;
}

export async function getDueWorkflows(): Promise<Workflow[]> {
  return getDb()
    .selectFrom("workflows")
    .where("enabled", "=", 1)
    .where("is_archived", "=", 0)
    .where("cron_schedule", "is not", null)
    .selectAll()
    .execute();
}
