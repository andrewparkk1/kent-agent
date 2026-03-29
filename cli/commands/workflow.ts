import { readFileSync, existsSync, readdirSync } from "node:fs";
import { resolve, basename, extname, join } from "node:path";
import { parse as parseYaml } from "yaml";
import { loadConfig, KENT_CONVEX_URL } from "@shared/config.ts";

// ── Types ────────────────────────────────────────────────────────────────

interface WorkflowYaml {
  name: string;
  description: string;
  runner: string;
  trigger: {
    type: "cron" | "event";
    schedule?: string;
    event?: string;
  };
  prompt: string;
  output: {
    target: "telegram" | "terminal" | "file";
    path?: string;
  };
}

interface ConvexWorkflow {
  _id: string;
  name: string;
  prompt: string;
  runner?: string;
  cronSchedule?: string;
  triggerSource?: string;
  outputTarget: string;
  enabled: boolean;
}

const VALID_SUBCOMMANDS = ["list", "run", "push", "disable"] as const;

export async function handleWorkflow(args: string[]): Promise<void> {
  const sub = args[0] as (typeof VALID_SUBCOMMANDS)[number] | undefined;

  if (!sub || !VALID_SUBCOMMANDS.includes(sub)) {
    console.log(`Usage:
  kent workflow push <file|directory>  Push YAML workflow(s) to Convex
  kent workflow list                   List all workflows
  kent workflow run <name>             Manually trigger a workflow
  kent workflow run <name> --runner cloud  Override runner
  kent workflow disable <name>         Disable a workflow`);
    process.exit(1);
  }

  switch (sub) {
    case "push":
      await workflowPush(args.slice(1));
      break;
    case "list":
      await workflowList();
      break;
    case "run":
      await workflowRun(args.slice(1));
      break;
    case "disable":
      await workflowDisable(args.slice(1));
      break;
  }
}

// ── Push ─────────────────────────────────────────────────────────────────

async function workflowPush(args: string[]): Promise<void> {
  let target = args[0];

  if (!target) {
    // Default: push all built-in templates
    target = join(import.meta.dir, "..", "workflows", "templates");
    console.log(`No file specified — pushing all built-in templates from:\n  ${target}\n`);
  }

  const resolvedPath = resolve(target);

  if (!existsSync(resolvedPath)) {
    console.error(`File or directory not found: ${resolvedPath}`);
    process.exit(1);
  }

  // Collect YAML files
  const files: string[] = [];
  const stat = Bun.file(resolvedPath);
  // Check if it's a directory by trying to list it
  try {
    const entries = readdirSync(resolvedPath);
    for (const entry of entries) {
      if (entry.endsWith(".yml") || entry.endsWith(".yaml")) {
        files.push(join(resolvedPath, entry));
      }
    }
  } catch {
    // It's a file
    files.push(resolvedPath);
  }

  if (files.length === 0) {
    console.error("No YAML files found.");
    process.exit(1);
  }

  const config = loadConfig();
  const convexUrl = KENT_CONVEX_URL;
  const deviceToken = config.core.device_token;

  for (const file of files) {
    try {
      const raw = readFileSync(file, "utf-8");
      const wf = parseYaml(raw) as WorkflowYaml;

      if (!wf.name || !wf.prompt || !wf.output?.target) {
        console.error(`  [skip] ${basename(file)}: missing required fields (name, prompt, output.target)`);
        continue;
      }

      const payload = {
        deviceToken,
        name: wf.name,
        prompt: wf.prompt,
        runner: wf.runner ?? "auto",
        cronSchedule: wf.trigger?.schedule ?? undefined,
        triggerSource: wf.trigger?.event ?? undefined,
        outputTarget: wf.output.target,
        outputPath: wf.output.path ?? undefined,
        enabled: true,
      };

      const res = await fetch(`${convexUrl}/api/mutation`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          path: "workflows:upsert",
          args: payload,
        }),
      });

      if (!res.ok) {
        const text = await res.text();
        console.error(`  [error] ${wf.name}: ${res.status} ${text}`);
      } else {
        console.log(`  [pushed] ${wf.name} (${wf.trigger?.type}: ${wf.trigger?.schedule ?? wf.trigger?.event ?? "manual"}) → ${wf.output.target}`);
      }
    } catch (err) {
      console.error(
        `  [error] ${basename(file)}: ${err instanceof Error ? err.message : err}`,
      );
    }
  }
}

// ── List ─────────────────────────────────────────────────────────────────

async function workflowList(): Promise<void> {
  const config = loadConfig();
  const convexUrl = KENT_CONVEX_URL;
  const deviceToken = config.core.device_token;

  try {
    const res = await fetch(`${convexUrl}/api/query`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        path: "workflows:list",
        args: { deviceToken },
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      console.error(`Failed to list workflows: ${res.status} ${text}`);
      process.exit(1);
    }

    const data = (await res.json()) as { value?: ConvexWorkflow[] };
    const workflows: ConvexWorkflow[] = data.value ?? [];

    if (workflows.length === 0) {
      console.log("No workflows found. Run `kent workflow push` to add some.");
      return;
    }

    // Print table
    console.log("");
    console.log(
      padRight("NAME", 20) +
        padRight("SCHEDULE", 22) +
        padRight("OUTPUT", 12) +
        padRight("RUNNER", 10) +
        "ENABLED",
    );
    console.log("─".repeat(80));

    for (const wf of workflows) {
      console.log(
        padRight(wf.name, 20) +
          padRight(wf.cronSchedule ?? "(manual)", 22) +
          padRight(wf.outputTarget, 12) +
          padRight(wf.runner ?? "auto", 10) +
          (wf.enabled ? "yes" : "no"),
      );
    }
    console.log("");
  } catch (err) {
    console.error(
      `Failed to list workflows: ${err instanceof Error ? err.message : err}`,
    );
    process.exit(1);
  }
}

// ── Run ──────────────────────────────────────────────────────────────────

async function workflowRun(args: string[]): Promise<void> {
  const name = args[0];
  if (!name) {
    console.error("Usage: kent workflow run <name> [--runner cloud|local|auto]");
    process.exit(1);
  }

  // Parse --runner override
  const runnerIdx = args.indexOf("--runner");
  const runnerOverride = runnerIdx !== -1 ? args[runnerIdx + 1] : undefined;

  const config = loadConfig();
  const convexUrl = KENT_CONVEX_URL;
  const deviceToken = config.core.device_token;

  // Fetch the workflow to get its prompt and config
  try {
    const res = await fetch(`${convexUrl}/api/query`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        path: "workflows:getByName",
        args: { deviceToken, name },
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      console.error(`Failed to fetch workflow "${name}": ${res.status} ${text}`);
      process.exit(1);
    }

    const data = (await res.json()) as { value?: ConvexWorkflow | null };
    const workflow: ConvexWorkflow | null = data.value ?? null;

    if (!workflow) {
      console.error(`Workflow "${name}" not found. Run \`kent workflow list\` to see available workflows.`);
      process.exit(1);
    }

    const runner = runnerOverride ?? workflow.runner ?? config.agent.default_runner;
    console.log(`Running workflow "${name}" with runner: ${runner}`);
    console.log(`Output target: ${workflow.outputTarget}`);
    console.log("");

    // Run through the agent
    let result: string;
    try {
      const { getRunner } = await import("@daemon/runner.ts");
      const agentRunner = getRunner(config, runner as "local" | "cloud" | undefined);
      const runResult = await agentRunner.run(workflow.prompt, undefined, undefined);
      result = runResult.output;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      result = `[Kent] Workflow "${name}" failed: ${msg}`;
    }

    // Route output to the right target
    switch (workflow.outputTarget) {
      case "telegram": {
        try {
          const { getChannel } = await import("../channels/channel.ts");
          const telegram = await getChannel("telegram");
          await telegram.notify(result, undefined);
          console.log("[output] Sent to Telegram");
        } catch (err) {
          console.error(
            `[output] Failed to send to Telegram: ${err instanceof Error ? err.message : err}`,
          );
          // Fall back to terminal
          console.log("\n--- Workflow Output (fallback to terminal) ---\n");
          console.log(result);
        }
        break;
      }
      case "file": {
        const { mkdirSync, writeFileSync } = await import("node:fs");
        const { homedir } = await import("node:os");
        const { join: pathJoin } = await import("node:path");

        // Resolve output path (expand ~)
        let outDir = "~/kent-reviews/";
        // Check if workflow has outputPath via raw query data
        // Default to ~/kent-reviews/ for weekly-review
        outDir = outDir.replace("~", homedir());
        mkdirSync(outDir, { recursive: true });

        const timestamp = new Date().toISOString().slice(0, 10);
        const filename = `${name}-${timestamp}.md`;
        const outPath = pathJoin(outDir, filename);

        writeFileSync(outPath, result, "utf-8");
        console.log(`[output] Written to ${outPath}`);
        break;
      }
      case "terminal":
      default:
        console.log("\n--- Workflow Output ---\n");
        console.log(result);
        break;
    }
  } catch (err) {
    console.error(
      `Failed to run workflow: ${err instanceof Error ? err.message : err}`,
    );
    process.exit(1);
  }
}

// ── Disable ──────────────────────────────────────────────────────────────

async function workflowDisable(args: string[]): Promise<void> {
  const name = args[0];
  if (!name) {
    console.error("Usage: kent workflow disable <name>");
    process.exit(1);
  }

  const config = loadConfig();
  const convexUrl = KENT_CONVEX_URL;
  const deviceToken = config.core.device_token;

  try {
    const res = await fetch(`${convexUrl}/api/mutation`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        path: "workflows:disable",
        args: { deviceToken, name },
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      console.error(`Failed to disable workflow: ${res.status} ${text}`);
      process.exit(1);
    }

    console.log(`Workflow "${name}" disabled.`);
  } catch (err) {
    console.error(
      `Failed to disable workflow: ${err instanceof Error ? err.message : err}`,
    );
    process.exit(1);
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────

function padRight(str: string, len: number): string {
  return str.length >= len ? str + " " : str + " ".repeat(len - str.length);
}
