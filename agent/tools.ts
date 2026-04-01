import { Type } from "@sinclair/typebox";
import type { AgentTool, AgentToolResult } from "@mariozechner/pi-agent-core";
import { searchItems, getItemsBySource, getItemCount } from "@shared/db.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const OUTPUT_DIR = process.env.OUTPUT_DIR ?? "/outputs";

function textResult(text: string): AgentToolResult<undefined> {
  return { content: [{ type: "text", text }], details: undefined };
}

function errorResult(text: string): AgentToolResult<undefined> {
  return { content: [{ type: "text", text }], details: undefined };
}

// ---------------------------------------------------------------------------
// Schema definitions
// ---------------------------------------------------------------------------

const SearchParams = Type.Object({
  query: Type.String({ description: "Keywords to search for in synced items" }),
  source: Type.Optional(
    Type.String({ description: "Filter to a specific source (e.g. 'imessage', 'gmail')" })
  ),
  limit: Type.Optional(
    Type.Number({ description: "Max results (default 50)" })
  ),
});

const GetRecentItemsParams = Type.Object({
  source: Type.Optional(
    Type.String({ description: "Filter to a specific source" })
  ),
  limit: Type.Optional(
    Type.Number({ description: "Max results (default 50)" })
  ),
});

const EmptyParams = Type.Object({});

const PathParams = Type.Object({
  path: Type.String({ description: "Absolute file path" }),
});

const SearchFilesParams = Type.Object({
  pattern: Type.String({ description: "Search pattern (regex)" }),
  path: Type.Optional(
    Type.String({
      description: "Directory to search in (default: home directory)",
    })
  ),
  glob: Type.Optional(
    Type.String({ description: 'File glob filter (e.g. "*.ts")' })
  ),
});

const WriteFileParams = Type.Object({
  path: Type.String({
    description: "File path (relative to output directory)",
  }),
  content: Type.String({ description: "File content" }),
});

const RunCommandParams = Type.Object({
  command: Type.String({ description: "The command to run" }),
  cwd: Type.Optional(Type.String({ description: "Working directory" })),
});

// ---------------------------------------------------------------------------
// Memory Tools (local SQLite)
// ---------------------------------------------------------------------------

const searchMemory: AgentTool<typeof SearchParams> = {
  name: "search_memory",
  label: "Searching memory...",
  description:
    "Search across all synced sources (iMessage, Gmail, GitHub, etc.) by keywords. Returns matching items sorted by recency.",
  parameters: SearchParams,
  execute: async (_id, params) => {
    try {
      const results = searchItems(params.query, params.limit ?? 50, params.source);
      return textResult(JSON.stringify(results, null, 2));
    } catch (e) {
      return errorResult(`search_memory failed: ${e}`);
    }
  },
};

const getRecentItems: AgentTool<typeof GetRecentItemsParams> = {
  name: "get_recent_items",
  label: "Getting recent items...",
  description:
    "Get the latest items from one or more sources, sorted by time. Good for 'what happened recently' queries.",
  parameters: GetRecentItemsParams,
  execute: async (_id, params) => {
    try {
      if (params.source) {
        const results = getItemsBySource(params.source, params.limit ?? 50);
        return textResult(JSON.stringify(results, null, 2));
      }
      // Get recent from all sources
      const counts = getItemCount();
      const allItems: any[] = [];
      for (const source of Object.keys(counts)) {
        const items = getItemsBySource(source, params.limit ?? 10);
        allItems.push(...items);
      }
      allItems.sort((a, b) => b.created_at - a.created_at);
      return textResult(JSON.stringify(allItems.slice(0, params.limit ?? 50), null, 2));
    } catch (e) {
      return errorResult(`get_recent_items failed: ${e}`);
    }
  },
};

const getSourceStats: AgentTool<typeof EmptyParams> = {
  name: "get_source_stats",
  label: "Getting source stats...",
  description:
    "Get item counts per source. Use to understand what data is available before searching.",
  parameters: EmptyParams,
  execute: async () => {
    try {
      const counts = getItemCount();
      return textResult(JSON.stringify(counts, null, 2));
    } catch (e) {
      return errorResult(`get_source_stats failed: ${e}`);
    }
  },
};

// ---------------------------------------------------------------------------
// Filesystem Tools
// ---------------------------------------------------------------------------

const readFile: AgentTool<typeof PathParams> = {
  name: "read_file",
  label: "Reading file...",
  description: "Read the contents of a file from the user's Mac.",
  parameters: PathParams,
  execute: async (_id, params) => {
    try {
      const file = Bun.file(params.path);
      const text = await file.text();
      return textResult(text);
    } catch (e) {
      return errorResult(`Failed to read ${params.path}: ${e}`);
    }
  },
};

const listDirectory: AgentTool<typeof PathParams> = {
  name: "list_directory",
  label: "Listing directory...",
  description: "List files and directories at a path.",
  parameters: PathParams,
  execute: async (_id, params) => {
    try {
      const { readdir } = await import("node:fs/promises");
      const entries = await readdir(params.path, { withFileTypes: true });
      const lines = entries.map(
        (e) => `${e.isDirectory() ? "d" : "f"} ${e.name}`
      );
      return textResult(lines.join("\n"));
    } catch (e) {
      return errorResult(`Failed to list ${params.path}: ${e}`);
    }
  },
};

const searchFiles: AgentTool<typeof SearchFilesParams> = {
  name: "search_files",
  label: "Searching files...",
  description: "Search file contents using ripgrep.",
  parameters: SearchFilesParams,
  execute: async (_id, params) => {
    try {
      const { homedir } = await import("node:os");
      const args = ["rg", "--max-count", "50", "-n"];
      if (params.glob) {
        args.push("--glob", params.glob);
      }
      args.push(params.pattern, params.path ?? homedir());

      const proc = Bun.spawn(args, {
        stdout: "pipe",
        stderr: "pipe",
      });
      const stdout = await new Response(proc.stdout).text();
      const stderr = await new Response(proc.stderr).text();
      await proc.exited;

      if (proc.exitCode !== 0 && !stdout) {
        return textResult(stderr || "No matches found.");
      }
      return textResult(stdout);
    } catch (e) {
      return errorResult(`search_files failed: ${e}`);
    }
  },
};

const writeFile: AgentTool<typeof WriteFileParams> = {
  name: "write_file",
  label: "Writing file...",
  description: "Write content to a file in the output directory.",
  parameters: WriteFileParams,
  execute: async (_id, params) => {
    try {
      const { join } = await import("node:path");
      const { mkdir } = await import("node:fs/promises");
      const fullPath = join(OUTPUT_DIR, params.path);

      const dir = fullPath.substring(0, fullPath.lastIndexOf("/"));
      if (dir) await mkdir(dir, { recursive: true });

      await Bun.write(fullPath, params.content);
      return textResult(`Wrote ${fullPath} (${params.content.length} bytes)`);
    } catch (e) {
      return errorResult(`Failed to write file: ${e}`);
    }
  },
};

const runCommand: AgentTool<typeof RunCommandParams> = {
  name: "run_command",
  label: "Running command...",
  description: "Execute a shell command on the user's Mac.",
  parameters: RunCommandParams,
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

      const output = [
        stdout ? `stdout:\n${stdout}` : "",
        stderr ? `stderr:\n${stderr}` : "",
        `exit code: ${proc.exitCode}`,
      ]
        .filter(Boolean)
        .join("\n");
      return textResult(output);
    } catch (e) {
      return errorResult(`run_command failed: ${e}`);
    }
  },
};

// ---------------------------------------------------------------------------
// Export all tools
// ---------------------------------------------------------------------------

export const memoryTools = [
  searchMemory,
  getRecentItems,
  getSourceStats,
] as unknown as AgentTool[];

export const filesystemTools = [
  readFile,
  listDirectory,
  searchFiles,
  writeFile,
  runCommand,
] as unknown as AgentTool[];

export const allTools = [...memoryTools, ...filesystemTools];
