import { Type, type Static } from "@sinclair/typebox";
import type { AgentTool, AgentToolResult } from "@mariozechner/pi-agent-core";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const RUNNER = process.env.RUNNER ?? "cloud";
const CONVEX_URL = process.env.CONVEX_URL ?? "";
const DEVICE_TOKEN = process.env.DEVICE_TOKEN ?? "";
const OUTPUT_DIR = process.env.OUTPUT_DIR ?? "/outputs";

function textResult(text: string): AgentToolResult<undefined> {
  return { content: [{ type: "text", text }], details: undefined };
}

function errorResult(text: string): AgentToolResult<undefined> {
  return { content: [{ type: "text", text }], details: undefined };
}

function localOnly(): AgentToolResult<undefined> {
  return errorResult(
    "This tool is only available in local runner mode. Start Kent with `kent --local` for filesystem access."
  );
}

async function convexCall(
  functionPath: string,
  args: Record<string, unknown>
): Promise<unknown> {
  const url = CONVEX_URL.replace(/\/$/, "");
  const res = await fetch(`${url}/api/query`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      path: functionPath,
      args: { ...args, deviceToken: DEVICE_TOKEN },
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Convex call ${functionPath} failed (${res.status}): ${body}`);
  }
  const data = (await res.json()) as { status: string; value?: unknown; errorMessage?: string };
  if (data.status === "error") {
    throw new Error(`Convex error: ${data.errorMessage ?? JSON.stringify(data)}`);
  }
  return data.value;
}

async function convexAction(
  functionPath: string,
  args: Record<string, unknown>
): Promise<unknown> {
  const url = CONVEX_URL.replace(/\/$/, "");
  const res = await fetch(`${url}/api/action`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      path: functionPath,
      args: { ...args, deviceToken: DEVICE_TOKEN },
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Convex action ${functionPath} failed (${res.status}): ${body}`);
  }
  const data = (await res.json()) as { status: string; value?: unknown; errorMessage?: string };
  if (data.status === "error") {
    throw new Error(`Convex error: ${data.errorMessage ?? JSON.stringify(data)}`);
  }
  return data.value;
}

// ---------------------------------------------------------------------------
// Schema definitions
// ---------------------------------------------------------------------------

const SearchSemanticParams = Type.Object({
  query: Type.String({ description: "Natural language search query" }),
  sources: Type.Optional(
    Type.Array(Type.String(), {
      description: "Filter to specific sources (e.g. ['imessage', 'gmail'])",
    })
  ),
  limit: Type.Optional(
    Type.Number({ description: "Max results (default 20)" })
  ),
});

const SearchExactParams = Type.Object({
  query: Type.String({ description: "Keywords to search" }),
  sources: Type.Optional(
    Type.Array(Type.String(), { description: "Filter to specific sources" })
  ),
  limit: Type.Optional(
    Type.Number({ description: "Max results (default 20)" })
  ),
});

const GetRecentItemsParams = Type.Object({
  sources: Type.Optional(
    Type.Array(Type.String(), { description: "Filter to specific sources" })
  ),
  limit: Type.Optional(
    Type.Number({ description: "Max results (default 20)" })
  ),
});

const BrowseItemsParams = Type.Object({
  source: Type.Optional(
    Type.String({ description: "Source name (e.g. 'imessage', 'gmail')" })
  ),
  sender: Type.Optional(
    Type.String({ description: "Filter by sender name" })
  ),
  after: Type.Optional(
    Type.String({ description: "ISO date string — items after this date" })
  ),
  before: Type.Optional(
    Type.String({ description: "ISO date string — items before this date" })
  ),
  cursor: Type.Optional(
    Type.String({ description: "Pagination cursor from previous result" })
  ),
  limit: Type.Optional(
    Type.Number({ description: "Max results per page (default 20)" })
  ),
});

const GetItemDetailParams = Type.Object({
  id: Type.String({ description: "Item ID" }),
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
// Memory Tools (Convex — work everywhere)
// ---------------------------------------------------------------------------

const searchSemantic: AgentTool<typeof SearchSemanticParams> = {
  name: "search_semantic",
  label: "Searching memory...",
  description:
    "Semantic search across all synced sources using embeddings. Best for natural language queries like 'what was discussed about deployment'.",
  parameters: SearchSemanticParams,
  execute: async (_id, params) => {
    try {
      const results = await convexAction("items:searchSemantic", {
        queryText: params.query,
        topK: params.limit ?? 20,
        source: params.sources?.[0],
      });
      return textResult(JSON.stringify(results, null, 2));
    } catch (e) {
      return errorResult(`search_semantic failed: ${e}`);
    }
  },
};

const searchExact: AgentTool<typeof SearchExactParams> = {
  name: "search_exact",
  label: "Searching keywords...",
  description:
    "Full-text keyword search across all synced sources. Best for exact names, IDs, or specific phrases.",
  parameters: SearchExactParams,
  execute: async (_id, params) => {
    try {
      const results = await convexCall("items:searchFTS", {
        queryText: params.query,
        source: params.sources?.[0],
        limit: params.limit ?? 20,
      });
      return textResult(JSON.stringify(results, null, 2));
    } catch (e) {
      return errorResult(`search_exact failed: ${e}`);
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
      const results = await convexCall("items:getRecentItems", {
        source: params.sources?.[0],
        limit: params.limit ?? 20,
      });
      return textResult(JSON.stringify(results, null, 2));
    } catch (e) {
      return errorResult(`get_recent_items failed: ${e}`);
    }
  },
};

const browseItems: AgentTool<typeof BrowseItemsParams> = {
  name: "browse_items",
  label: "Browsing items...",
  description:
    "Filter and paginate items by source, date range, or sender. Use for structured browsing.",
  parameters: BrowseItemsParams,
  execute: async (_id, params) => {
    try {
      const results = await convexCall("items:browse", {
        source: params.source,
        sender: params.sender,
        startDate: params.after ? new Date(params.after).getTime() : undefined,
        endDate: params.before
          ? new Date(params.before).getTime()
          : undefined,
        paginationOpts: {
          numItems: params.limit ?? 20,
          cursor: params.cursor ?? null,
        },
      });
      return textResult(JSON.stringify(results, null, 2));
    } catch (e) {
      return errorResult(`browse_items failed: ${e}`);
    }
  },
};

const getItemDetail: AgentTool<typeof GetItemDetailParams> = {
  name: "get_item_detail",
  label: "Getting item detail...",
  description:
    "Get the full content of a specific item by its ID. Use when search results are truncated.",
  parameters: GetItemDetailParams,
  execute: async (_id, params) => {
    try {
      const result = await convexCall("items:getById", {
        itemId: params.id,
      });
      return textResult(JSON.stringify(result, null, 2));
    } catch (e) {
      return errorResult(`get_item_detail failed: ${e}`);
    }
  },
};

const getSourceStats: AgentTool<typeof EmptyParams> = {
  name: "get_source_stats",
  label: "Getting source stats...",
  description:
    "Get item counts and date ranges per source. Use to understand what data is available before searching.",
  parameters: EmptyParams,
  execute: async () => {
    try {
      const result = await convexCall("items:getStats", {});
      return textResult(JSON.stringify(result, null, 2));
    } catch (e) {
      return errorResult(`get_source_stats failed: ${e}`);
    }
  },
};

// ---------------------------------------------------------------------------
// Filesystem Tools (local runner only)
// ---------------------------------------------------------------------------

const readFile: AgentTool<typeof PathParams> = {
  name: "read_file",
  label: "Reading file...",
  description: "Read the contents of a file on the user's Mac. Local runner only.",
  parameters: PathParams,
  execute: async (_id, params) => {
    if (RUNNER !== "local") return localOnly();
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
  description: "List files and directories at a path. Local runner only.",
  parameters: PathParams,
  execute: async (_id, params) => {
    if (RUNNER !== "local") return localOnly();
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
  description:
    "Search file contents using ripgrep. Local runner only.",
  parameters: SearchFilesParams,
  execute: async (_id, params) => {
    if (RUNNER !== "local") return localOnly();
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
  description:
    "Write content to a file in the output directory. Local runner only.",
  parameters: WriteFileParams,
  execute: async (_id, params) => {
    if (RUNNER !== "local") return localOnly();
    try {
      const { join } = await import("node:path");
      const { mkdir } = await import("node:fs/promises");
      const fullPath = join(OUTPUT_DIR, params.path);

      // Ensure parent directory exists
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
  description:
    "Execute a shell command on the user's Mac. Local runner only.",
  parameters: RunCommandParams,
  execute: async (_id, params) => {
    if (RUNNER !== "local") return localOnly();
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

/** Memory tools — always available */
export const memoryTools = [
  searchSemantic,
  searchExact,
  getRecentItems,
  browseItems,
  getItemDetail,
  getSourceStats,
] as unknown as AgentTool[];

/** Filesystem tools — local runner only (return error in cloud mode) */
export const filesystemTools = [
  readFile,
  listDirectory,
  searchFiles,
  writeFile,
  runCommand,
] as unknown as AgentTool[];

/** All tools combined */
export const allTools = [...memoryTools, ...filesystemTools];
