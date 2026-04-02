/** Workflow tools — create/manage scheduled automations. */
import { Type } from "@sinclair/typebox";
import type { AgentTool } from "@mariozechner/pi-agent-core";
import { createWorkflow, listWorkflows, deleteWorkflow, updateWorkflow, getWorkflow } from "@shared/db.ts";
import { ok, err, json } from "./helpers.ts";

const Empty = Type.Object({});

export const wfCreate: AgentTool<any> = {
  name: "create_workflow",
  label: "Creating workflow...",
  description: "Create a scheduled or manual workflow. Cron examples: '0 9 * * 1-5' (9am weekdays), '0 18 * * *' (6pm daily).",
  parameters: Type.Object({
    name: Type.String({ description: "Short name (e.g. 'daily-brief')" }),
    prompt: Type.String({ description: "The prompt the agent executes when the workflow runs" }),
    description: Type.Optional(Type.String({ description: "What this workflow does" })),
    cron_schedule: Type.Optional(Type.String({ description: "Cron expression. Omit for manual-only." })),
    type: Type.Optional(Type.String({ description: "cron, manual, or event" })),
    source: Type.Optional(Type.String({ description: "user or suggested" })),
  }),
  execute: async (_id, params) => {
    try {
      const id = await createWorkflow({
        name: params.name, prompt: params.prompt, description: params.description,
        cron_schedule: params.cron_schedule, type: (params.type as any) ?? undefined,
        source: (params.source as any) ?? "user",
      });
      const info = params.cron_schedule ? `Scheduled: ${params.cron_schedule}` : "Manual trigger only";
      return ok(`Workflow "${params.name}" created (id: ${id}). ${info}`);
    } catch (e) { return err(`Failed to create workflow: ${e}`); }
  },
};

export const wfList: AgentTool<any> = {
  name: "list_workflows",
  label: "Listing workflows...",
  description: "List all configured workflows with their schedules and status.",
  parameters: Empty,
  execute: async () => {
    try {
      const workflows = await listWorkflows();
      if (workflows.length === 0) return ok("No workflows configured yet.");
      return json(workflows.map((wf) => ({
        name: wf.name, description: wf.description, cron: wf.cron_schedule ?? "manual",
        type: wf.type, source: wf.source, enabled: !!wf.enabled,
        lastRun: wf.last_run_at ? new Date(wf.last_run_at * 1000).toISOString() : "never",
      })));
    } catch (e) { return err(`Failed to list workflows: ${e}`); }
  },
};

export const wfDelete: AgentTool<any> = {
  name: "delete_workflow",
  label: "Deleting workflow...",
  description: "Delete a workflow by name.",
  parameters: Type.Object({ name: Type.String({ description: "Name of the workflow" }) }),
  execute: async (_id, params) => {
    try {
      return (await deleteWorkflow(params.name)) ? ok(`Workflow "${params.name}" deleted.`) : err(`Workflow "${params.name}" not found.`);
    } catch (e) { return err(`Failed to delete workflow: ${e}`); }
  },
};

export const wfUpdate: AgentTool<any> = {
  name: "update_workflow",
  label: "Updating workflow...",
  description: "Update an existing workflow's fields (name, description, prompt, cron_schedule, enabled).",
  parameters: Type.Object({
    name: Type.String({ description: "Current name of the workflow to update" }),
    updates: Type.Object({
      name: Type.Optional(Type.String({ description: "New name" })),
      description: Type.Optional(Type.String({ description: "New description" })),
      prompt: Type.Optional(Type.String({ description: "New prompt" })),
      cron_schedule: Type.Optional(Type.String({ description: "New cron expression" })),
      enabled: Type.Optional(Type.Number({ description: "1 to enable, 0 to disable" })),
    }, { description: "Fields to update" }),
  }),
  execute: async (_id, params) => {
    try {
      const wf = await getWorkflow(params.name);
      if (!wf) return err(`Workflow "${params.name}" not found.`);
      await updateWorkflow(wf.id, params.updates);
      const fields = Object.keys(params.updates).join(", ");
      return ok(`Workflow "${params.name}" updated (${fields}).`);
    } catch (e) { return err(`Failed to update workflow: ${e}`); }
  },
};

export const workflowTools = [wfCreate, wfList, wfDelete, wfUpdate] as AgentTool[];
