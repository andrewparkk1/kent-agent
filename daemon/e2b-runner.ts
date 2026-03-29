import { Sandbox } from "e2b";
import { BaseRunner, type RunResult, type StreamCallback } from "./runner-base.ts";
import type { Config } from "@shared/config.ts";
import { CONVEX_URL } from "@shared/config.ts";

const SANDBOX_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes

// Kent-managed E2B template — users don't configure this
const KENT_E2B_TEMPLATE_ID = process.env.E2B_TEMPLATE_ID || "andysampark/kent-agent";

export class E2BRunner extends BaseRunner {
  private config: Config;
  private sandbox: Sandbox | null = null;
  private sandboxId: string | null = null;

  constructor(config: Config) {
    super();
    this.config = config;
  }

  /**
   * Get or create a persistent sandbox.
   * Reuses existing sandbox if still alive, otherwise creates a new one.
   */
  private async getOrCreateSandbox(): Promise<Sandbox> {
    // Try to reconnect to existing sandbox
    if (this.sandboxId) {
      try {
        this.sandbox = await Sandbox.connect(this.sandboxId, {
          timeoutMs: SANDBOX_TIMEOUT_MS,
        });
        return this.sandbox;
      } catch {
        // Sandbox died or expired, create a new one
        this.sandboxId = null;
        this.sandbox = null;
      }
    }

    // Create new sandbox from Kent's hosted template
    this.sandbox = await Sandbox.create(KENT_E2B_TEMPLATE_ID, {
      timeoutMs: SANDBOX_TIMEOUT_MS,
      envs: this.buildEnvVars(),
    });
    this.sandboxId = this.sandbox.sandboxId;

    return this.sandbox;
  }

  private buildEnvVars(extra?: Record<string, string>): Record<string, string> {
    return {
      ANTHROPIC_API_KEY: this.config.keys.anthropic,
      CONVEX_URL: CONVEX_URL,
      DEVICE_TOKEN: this.config.core.device_token,
      RUNNER: "cloud",
      OUTPUT_DIR: "/outputs",
      MODEL: this.config.agent.default_model,
      MAX_TURNS: String(this.config.agent.max_turns),
      ...extra,
    };
  }

  async run(
    prompt: string,
    workflowId?: string,
    streamCallback?: StreamCallback
  ): Promise<RunResult> {
    const sandbox = await this.getOrCreateSandbox();
    const runId = crypto.randomUUID();

    // Set per-run env vars by writing a small env file and sourcing it
    const envVars = {
      RUN_ID: runId,
      PROMPT: prompt,
      ...(workflowId ? { WORKFLOW_ID: workflowId } : {}),
    };

    // Write prompt to a temp file to avoid shell escaping issues
    await sandbox.files.write("/tmp/prompt.txt", prompt);

    // Build the command: read prompt from file, run agent
    const envExports = Object.entries(envVars)
      .filter(([k]) => k !== "PROMPT")
      .map(([k, v]) => `export ${k}="${v.replace(/"/g, '\\"')}"`)
      .join(" && ");

    const cmd = [
      envExports,
      `export PROMPT="$(cat /tmp/prompt.txt)"`,
      "cd /agent",
      "bun run agent.ts",
    ].join(" && ");

    let output = "";

    const result = await sandbox.commands.run(cmd, {
      timeoutMs: SANDBOX_TIMEOUT_MS,
      envs: this.buildEnvVars(envVars),
      onStdout: (data) => {
        output += data;
        streamCallback?.(data);
      },
      onStderr: (data) => {
        // Log stderr but don't include in output
        if (streamCallback) {
          // Tool call indicators go to stderr, forward them
          streamCallback(data);
        }
      },
    });

    // Collect output files
    const files: Record<string, string> = {};
    try {
      const outputEntries = await sandbox.files.list("/outputs");
      for (const entry of outputEntries) {
        if (entry.type === "file") {
          const content = await sandbox.files.read(`/outputs/${entry.name}`);
          files[entry.name] = content;
        }
      }
    } catch {
      // No output files, that's fine
    }

    // Extend sandbox timeout to keep it warm for the next run
    try {
      await Sandbox.setTimeout(sandbox.sandboxId, SANDBOX_TIMEOUT_MS);
    } catch {
      // Non-critical
    }

    return { runId, output, files };
  }

  async kill(): Promise<void> {
    if (this.sandboxId) {
      try {
        await Sandbox.kill(this.sandboxId);
      } catch {
        // Already dead
      }
      this.sandboxId = null;
      this.sandbox = null;
    }
  }
}
