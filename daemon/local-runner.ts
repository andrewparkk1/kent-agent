/**
 * Runs the agent as a local Bun subprocess. Spawns `bun run agent/agent.ts` with the
 * prompt and config passed via env vars, streams stdout (text) and stderr (tool events)
 * back to the caller in real time, and collects any output files the agent writes.
 */
import { join } from "node:path";
import { mkdirSync, readdirSync, readFileSync } from "node:fs";
import { BaseRunner, type RunResult, type StreamCallback, type TypedStreamCallback } from "./runner-base.ts";
import type { Config } from "@shared/config.ts";
import { KENT_DIR } from "@shared/config.ts";

export class LocalRunner extends BaseRunner {
  private config: Config;

  constructor(config: Config) {
    super();
    this.config = config;
  }

  async run(
    prompt: string,
    workflowId?: string,
    streamCallback?: StreamCallback | TypedStreamCallback,
    options?: { threadId?: string }
  ): Promise<RunResult> {
    const runId = crypto.randomUUID();
    const runsDir = join(KENT_DIR, "runs", runId);
    const outputDir = join(runsDir, "outputs");
    mkdirSync(outputDir, { recursive: true });

    // Resolve the agent entry point
    const agentPath = join(
      import.meta.dir,
      "..",
      "agent",
      "agent.ts"
    );

    const env: Record<string, string> = {
      ...process.env as Record<string, string>,
      ANTHROPIC_API_KEY: this.config.keys.anthropic || process.env.ANTHROPIC_API_KEY || "",
      DEVICE_TOKEN: this.config.core.device_token || process.env.DEVICE_TOKEN || "",
      RUNNER: "local",
      RUN_ID: runId,
      PROMPT: prompt,
      OUTPUT_DIR: outputDir,
      MODEL: this.config.agent.default_model,
      MAX_TURNS: String(this.config.agent.max_turns),
      KENT_HOME: join(import.meta.dir, ".."),
      ...(workflowId ? { WORKFLOW_ID: workflowId } : {}),
      ...(options?.threadId ? { THREAD_ID: options.threadId } : {}),
    };

    const proc = Bun.spawn(["bun", "run", agentPath], {
      env,
      stdout: "pipe",
      stderr: "pipe",
      cwd: join(import.meta.dir, ".."),
    });

    let output = "";

    // Detect if callback accepts typed args (2 params) or legacy (1 param)
    const emit = streamCallback
      ? streamCallback.length >= 2
        ? (chunk: string, type: "text" | "tool") => (streamCallback as TypedStreamCallback)(chunk, type)
        : (chunk: string, _type: "text" | "tool") => (streamCallback as StreamCallback)(chunk)
      : null;

    // Stream stdout
    const stdoutReader = (async () => {
      const reader = proc.stdout.getReader();
      const decoder = new TextDecoder();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        output += chunk;
        emit?.(chunk, "text");
      }
    })();

    // Stream stderr (tool indicators)
    const stderrReader = (async () => {
      const reader = proc.stderr.getReader();
      const decoder = new TextDecoder();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        emit?.(chunk, "tool");
      }
    })();

    await Promise.all([stdoutReader, stderrReader]);
    await proc.exited;

    // Collect output files
    const files: Record<string, string> = {};
    try {
      const entries = readdirSync(outputDir);
      for (const name of entries) {
        const content = readFileSync(join(outputDir, name), "utf-8");
        files[name] = content;
      }
    } catch {
      // No output files
    }

    return { runId, output, files };
  }

  async kill(): Promise<void> {
    // Nothing to clean up — subprocess exits when agent finishes
  }
}
