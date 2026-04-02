/** Filesystem tools — read, write, search files + run shell commands. */
import { Type } from "@sinclair/typebox";
import type { AgentTool } from "@mariozechner/pi-agent-core";
import { ok, err, OUTPUT_DIR } from "./helpers.ts";

export const fsRead: AgentTool<any> = {
  name: "read_file",
  label: "Reading file...",
  description: "Read the contents of a file from the user's Mac.",
  parameters: Type.Object({ path: Type.String({ description: "Absolute file path" }) }),
  execute: async (_id, params) => {
    try { return ok(await Bun.file(params.path).text()); }
    catch (e) { return err(`Failed to read ${params.path}: ${e}`); }
  },
};

export const fsListDir: AgentTool<any> = {
  name: "list_directory",
  label: "Listing directory...",
  description: "List files and directories at a path.",
  parameters: Type.Object({ path: Type.String({ description: "Absolute directory path" }) }),
  execute: async (_id, params) => {
    try {
      const { readdir } = await import("node:fs/promises");
      const entries = await readdir(params.path, { withFileTypes: true });
      return ok(entries.map((e) => `${e.isDirectory() ? "d" : "f"} ${e.name}`).join("\n"));
    } catch (e) { return err(`Failed to list ${params.path}: ${e}`); }
  },
};

export const fsSearch: AgentTool<any> = {
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
    } catch (e) { return err(`search_files failed: ${e}`); }
  },
};

export const fsWrite: AgentTool<any> = {
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
      if (fullPath.startsWith("~/")) fullPath = join(homedir(), fullPath.slice(2));
      else if (!fullPath.startsWith("/")) fullPath = join(OUTPUT_DIR, fullPath);
      const dir = fullPath.substring(0, fullPath.lastIndexOf("/"));
      if (dir) await mkdir(dir, { recursive: true });
      await Bun.write(fullPath, params.content);
      return ok(`Wrote ${fullPath} (${params.content.length} bytes)`);
    } catch (e) { return err(`Failed to write file: ${e}`); }
  },
};

export const fsRunCommand: AgentTool<any> = {
  name: "run_command",
  label: "Running command...",
  description: "Execute a shell command on the user's Mac.",
  parameters: Type.Object({
    command: Type.String({ description: "The command to run" }),
    cwd: Type.Optional(Type.String({ description: "Working directory" })),
  }),
  execute: async (_id, params) => {
    const TIMEOUT_MS = 60_000; // 60s timeout for commands
    try {
      const proc = Bun.spawn(["bash", "-c", params.command], {
        cwd: params.cwd, stdout: "pipe", stderr: "pipe", env: { ...process.env },
      });
      const timeout = new Promise<never>((_, reject) =>
        setTimeout(() => { proc.kill(); reject(new Error(`Command timed out after ${TIMEOUT_MS / 1000}s`)); }, TIMEOUT_MS)
      );
      const [stdout, stderr] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
      ]);
      await Promise.race([proc.exited, timeout]);
      const output = [stdout ? `stdout:\n${stdout}` : "", stderr ? `stderr:\n${stderr}` : ""].filter(Boolean).join("\n");
      if (proc.exitCode !== 0) {
        return err(output || `Command failed with exit code ${proc.exitCode}`);
      }
      return ok(output || "(no output)");
    } catch (e) { return err(`run_command failed: ${e}`); }
  },
};

export const filesystemTools = [fsRead, fsListDir, fsSearch, fsWrite, fsRunCommand] as AgentTool[];
