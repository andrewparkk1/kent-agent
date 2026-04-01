/**
 * Agent tools — everything the agent can do during a conversation.
 *
 * Organized into four groups:
 *   1. Data Sources  — search/browse synced items (iMessage, Gmail, GitHub, etc.)
 *   2. Memories       — persistent knowledge base across sessions
 *   3. Workflows      — scheduled/manual automation
 *   4. Filesystem     — read, write, search files + run shell commands
 */
import { Type } from "@sinclair/typebox";
import type { AgentTool, AgentToolResult } from "@mariozechner/pi-agent-core";
import {
  // Data sources
  searchItems, getItemsBySource, getItemCount,
  // Memories
  createMemory, updateMemory, archiveMemory, listMemories, searchMemories,
  type MemoryType,
  // Workflows
  createWorkflow, listWorkflows, deleteWorkflow,
} from "@shared/db.ts";

// ─── Helpers ────────────────────────────────────────────────────────────────

const OUTPUT_DIR = process.env.OUTPUT_DIR ?? "/outputs";

function ok(text: string): AgentToolResult<undefined> {
  return { content: [{ type: "text", text }], details: undefined };
}

function err(text: string): AgentToolResult<undefined> {
  return { content: [{ type: "text", text }], details: undefined };
}

function json(data: unknown): AgentToolResult<undefined> {
  return ok(JSON.stringify(data, null, 2));
}

// ─── Shared Schemas ─────────────────────────────────────────────────────────

const Empty = Type.Object({});

// ═══════════════════════════════════════════════════════════════════════════
// 1. DATA SOURCE TOOLS
// ═══════════════════════════════════════════════════════════════════════════

const searchData: AgentTool<any> = {
  name: "search_memory",
  label: "Searching memory...",
  description: "Search across all synced sources (iMessage, Gmail, GitHub, etc.) by keywords. Returns matching items sorted by relevance.",
  parameters: Type.Object({
    query: Type.String({ description: "Keywords to search for" }),
    source: Type.Optional(Type.String({ description: "Filter to a specific source (e.g. 'imessage', 'gmail')" })),
    limit: Type.Optional(Type.Number({ description: "Max results (default 50)" })),
  }),
  execute: async (_id, params) => {
    try {
      return json(searchItems(params.query, params.limit ?? 50, params.source));
    } catch (e) {
      return err(`search_memory failed: ${e}`);
    }
  },
};

const getRecent: AgentTool<any> = {
  name: "get_recent_items",
  label: "Getting recent items...",
  description: "Get the latest items from one or more sources, sorted by time.",
  parameters: Type.Object({
    source: Type.Optional(Type.String({ description: "Filter to a specific source" })),
    limit: Type.Optional(Type.Number({ description: "Max results (default 50)" })),
  }),
  execute: async (_id, params) => {
    try {
      if (params.source) {
        return json(getItemsBySource(params.source, params.limit ?? 50));
      }
      const counts = getItemCount();
      const all: any[] = [];
      for (const source of Object.keys(counts)) {
        all.push(...getItemsBySource(source, params.limit ?? 10));
      }
      all.sort((a, b) => b.created_at - a.created_at);
      return json(all.slice(0, params.limit ?? 50));
    } catch (e) {
      return err(`get_recent_items failed: ${e}`);
    }
  },
};

const getStats: AgentTool<any> = {
  name: "get_source_stats",
  label: "Getting source stats...",
  description: "Get item counts per source. Use to understand what data is available before searching.",
  parameters: Empty,
  execute: async () => {
    try {
      return json(getItemCount());
    } catch (e) {
      return err(`get_source_stats failed: ${e}`);
    }
  },
};

// ═══════════════════════════════════════════════════════════════════════════
// 2. MEMORY TOOLS
// ═══════════════════════════════════════════════════════════════════════════

const memCreate: AgentTool<any> = {
  name: "create_memory",
  label: "Creating memory...",
  description: "Create a new memory entry. Use for people, projects, topics, events, preferences, or places worth remembering.",
  parameters: Type.Object({
    type: Type.String({ description: "person, project, topic, event, preference, or place" }),
    title: Type.String({ description: "Short title (e.g. person's name, project name)" }),
    body: Type.String({ description: "2-5 sentences of useful context" }),
    sources: Type.Optional(Type.Array(Type.String(), { description: "Data sources this came from" })),
    aliases: Type.Optional(Type.Array(Type.String(), { description: "Alternative names (nicknames, emails)" })),
  }),
  execute: async (_id, params) => {
    try {
      const id = createMemory({
        type: params.type as MemoryType,
        title: params.title,
        body: params.body,
        sources: params.sources,
        aliases: params.aliases,
      });
      return ok(`Memory created: "${params.title}" (${params.type}, id: ${id})`);
    } catch (e) {
      return err(`Failed to create memory: ${e}`);
    }
  },
};

const memUpdate: AgentTool<any> = {
  name: "update_memory",
  label: "Updating memory...",
  description: "Update an existing memory. Use to keep memories current as you learn new information.",
  parameters: Type.Object({
    id: Type.String({ description: "Memory ID to update" }),
    title: Type.Optional(Type.String()),
    body: Type.Optional(Type.String()),
    type: Type.Optional(Type.String()),
    sources: Type.Optional(Type.Array(Type.String())),
    aliases: Type.Optional(Type.Array(Type.String())),
  }),
  execute: async (_id, params) => {
    try {
      const { id, ...fields } = params;
      updateMemory(id, fields as any);
      return ok(`Memory "${id}" updated.`);
    } catch (e) {
      return err(`Failed to update memory: ${e}`);
    }
  },
};

const memArchive: AgentTool<any> = {
  name: "archive_memory",
  label: "Archiving memory...",
  description: "Archive a stale memory (30+ days no activity, completed project, past event).",
  parameters: Type.Object({
    id: Type.String({ description: "Memory ID" }),
  }),
  execute: async (_id, params) => {
    try {
      archiveMemory(params.id);
      return ok(`Memory "${params.id}" archived.`);
    } catch (e) {
      return err(`Failed to archive memory: ${e}`);
    }
  },
};

const memList: AgentTool<any> = {
  name: "list_memories",
  label: "Listing memories...",
  description: "List all active memories, optionally filtered by type.",
  parameters: Type.Object({
    type: Type.Optional(Type.String({ description: "Filter by type" })),
  }),
  execute: async (_id, params) => {
    try {
      const memories = listMemories({ type: params.type as MemoryType | undefined });
      if (memories.length === 0) return ok("No memories yet.");
      return json(memories.map((m) => ({
        id: m.id, type: m.type, title: m.title, body: m.body,
        aliases: JSON.parse(m.aliases),
        updated: new Date(m.updated_at * 1000).toISOString(),
      })));
    } catch (e) {
      return err(`Failed to list memories: ${e}`);
    }
  },
};

const memSearch: AgentTool<any> = {
  name: "search_memories",
  label: "Searching memories...",
  description: "Search memories by keyword across titles, bodies, and aliases.",
  parameters: Type.Object({
    query: Type.String({ description: "Search term" }),
  }),
  execute: async (_id, params) => {
    try {
      const results = searchMemories(params.query);
      if (results.length === 0) return ok("No matching memories found.");
      return json(results.map((m) => ({
        id: m.id, type: m.type, title: m.title, body: m.body,
        aliases: JSON.parse(m.aliases),
      })));
    } catch (e) {
      return err(`Failed to search memories: ${e}`);
    }
  },
};

// ═══════════════════════════════════════════════════════════════════════════
// 3. WORKFLOW TOOLS
// ═══════════════════════════════════════════════════════════════════════════

const wfCreate: AgentTool<any> = {
  name: "create_workflow",
  label: "Creating workflow...",
  description: "Create a scheduled or manual workflow. Cron examples: '0 9 * * 1-5' (9am weekdays), '0 18 * * *' (6pm daily), '0 */2 * * *' (every 2h).",
  parameters: Type.Object({
    name: Type.String({ description: "Short name (e.g. 'daily-brief')" }),
    prompt: Type.String({ description: "The prompt the agent executes when the workflow runs" }),
    description: Type.Optional(Type.String({ description: "What this workflow does" })),
    cron_schedule: Type.Optional(Type.String({ description: "Cron expression. Omit for manual-only." })),
    type: Type.Optional(Type.String({ description: "cron, manual, or event (default: cron if schedule provided)" })),
    source: Type.Optional(Type.String({ description: "user or suggested (default: user)" })),
  }),
  execute: async (_id, params) => {
    try {
      const id = createWorkflow({
        name: params.name,
        prompt: params.prompt,
        description: params.description,
        cron_schedule: params.cron_schedule,
        type: (params.type as any) ?? undefined,
        source: (params.source as any) ?? "user",
      });
      const info = params.cron_schedule ? `Scheduled: ${params.cron_schedule}` : "Manual trigger only";
      return ok(`Workflow "${params.name}" created (id: ${id}). ${info}`);
    } catch (e) {
      return err(`Failed to create workflow: ${e}`);
    }
  },
};

const wfList: AgentTool<any> = {
  name: "list_workflows",
  label: "Listing workflows...",
  description: "List all configured workflows with their schedules and status.",
  parameters: Empty,
  execute: async () => {
    try {
      const workflows = listWorkflows();
      if (workflows.length === 0) return ok("No workflows configured yet.");
      return json(workflows.map((wf) => ({
        name: wf.name, description: wf.description,
        cron: wf.cron_schedule ?? "manual",
        type: wf.type, source: wf.source, enabled: !!wf.enabled,
        lastRun: wf.last_run_at ? new Date(wf.last_run_at * 1000).toISOString() : "never",
      })));
    } catch (e) {
      return err(`Failed to list workflows: ${e}`);
    }
  },
};

const wfDelete: AgentTool<any> = {
  name: "delete_workflow",
  label: "Deleting workflow...",
  description: "Delete a workflow by name.",
  parameters: Type.Object({
    name: Type.String({ description: "Name of the workflow" }),
  }),
  execute: async (_id, params) => {
    try {
      return deleteWorkflow(params.name)
        ? ok(`Workflow "${params.name}" deleted.`)
        : err(`Workflow "${params.name}" not found.`);
    } catch (e) {
      return err(`Failed to delete workflow: ${e}`);
    }
  },
};

// ═══════════════════════════════════════════════════════════════════════════
// 4. FILESYSTEM TOOLS
// ═══════════════════════════════════════════════════════════════════════════

const fsRead: AgentTool<any> = {
  name: "read_file",
  label: "Reading file...",
  description: "Read the contents of a file from the user's Mac.",
  parameters: Type.Object({
    path: Type.String({ description: "Absolute file path" }),
  }),
  execute: async (_id, params) => {
    try {
      return ok(await Bun.file(params.path).text());
    } catch (e) {
      return err(`Failed to read ${params.path}: ${e}`);
    }
  },
};

const fsListDir: AgentTool<any> = {
  name: "list_directory",
  label: "Listing directory...",
  description: "List files and directories at a path.",
  parameters: Type.Object({
    path: Type.String({ description: "Absolute directory path" }),
  }),
  execute: async (_id, params) => {
    try {
      const { readdir } = await import("node:fs/promises");
      const entries = await readdir(params.path, { withFileTypes: true });
      return ok(entries.map((e) => `${e.isDirectory() ? "d" : "f"} ${e.name}`).join("\n"));
    } catch (e) {
      return err(`Failed to list ${params.path}: ${e}`);
    }
  },
};

const fsSearch: AgentTool<any> = {
  name: "search_files",
  label: "Searching files...",
  description: "Search file contents using ripgrep.",
  parameters: Type.Object({
    pattern: Type.String({ description: "Search pattern (regex)" }),
    path: Type.Optional(Type.String({ description: "Directory to search (default: home)" })),
    glob: Type.Optional(Type.String({ description: 'File glob filter (e.g. "*.ts")' })),
  }),
  execute: async (_id, params) => {
    try {
      const { homedir } = await import("node:os");
      const args = ["rg", "--max-count", "50", "-n"];
      if (params.glob) args.push("--glob", params.glob);
      args.push(params.pattern, params.path ?? homedir());

      const proc = Bun.spawn(args, { stdout: "pipe", stderr: "pipe" });
      const stdout = await new Response(proc.stdout).text();
      const stderr = await new Response(proc.stderr).text();
      await proc.exited;

      return ok(stdout || stderr || "No matches found.");
    } catch (e) {
      return err(`search_files failed: ${e}`);
    }
  },
};

const fsWrite: AgentTool<any> = {
  name: "write_file",
  label: "Writing file...",
  description: "Write content to a file. Absolute path or ~/path writes directly; relative path writes to output directory.",
  parameters: Type.Object({
    path: Type.String({ description: "File path (absolute, ~/relative, or relative to output dir)" }),
    content: Type.String({ description: "File content" }),
  }),
  execute: async (_id, params) => {
    try {
      const { join } = await import("node:path");
      const { mkdir } = await import("node:fs/promises");
      const { homedir } = await import("node:os");

      let fullPath = params.path;
      if (fullPath.startsWith("~/")) {
        fullPath = join(homedir(), fullPath.slice(2));
      } else if (!fullPath.startsWith("/")) {
        fullPath = join(OUTPUT_DIR, fullPath);
      }

      const dir = fullPath.substring(0, fullPath.lastIndexOf("/"));
      if (dir) await mkdir(dir, { recursive: true });

      await Bun.write(fullPath, params.content);
      return ok(`Wrote ${fullPath} (${params.content.length} bytes)`);
    } catch (e) {
      return err(`Failed to write file: ${e}`);
    }
  },
};

const fsRunCommand: AgentTool<any> = {
  name: "run_command",
  label: "Running command...",
  description: "Execute a shell command on the user's Mac.",
  parameters: Type.Object({
    command: Type.String({ description: "The command to run" }),
    cwd: Type.Optional(Type.String({ description: "Working directory" })),
  }),
  execute: async (_id, params) => {
    try {
      const proc = Bun.spawn(["bash", "-c", params.command], {
        cwd: params.cwd,
        stdout: "pipe",
        stderr: "pipe",
        env: { ...process.env },
      });
      const stdout = await new Response(proc.stdout).text();
      const stderr = await new Response(proc.stderr).text();
      await proc.exited;

      return ok([
        stdout ? `stdout:\n${stdout}` : "",
        stderr ? `stderr:\n${stderr}` : "",
        `exit code: ${proc.exitCode}`,
      ].filter(Boolean).join("\n"));
    } catch (e) {
      return err(`run_command failed: ${e}`);
    }
  },
};

// ═══════════════════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════════════════

export const dataTools = [searchData, getRecent, getStats] as AgentTool[];
export const memoryTools = [memCreate, memUpdate, memArchive, memList, memSearch] as AgentTool[];
export const workflowTools = [wfCreate, wfList, wfDelete] as AgentTool[];
export const filesystemTools = [fsRead, fsListDir, fsSearch, fsWrite, fsRunCommand] as AgentTool[];

export const allTools = [...dataTools, ...memoryTools, ...workflowTools, ...filesystemTools];
