import {
  listWorkflows,
  getWorkflow,
  createWorkflow,
  updateWorkflow,
  deleteWorkflow,
  getWorkflowRuns,
  getMessages,
  createThread,
  finishThread,
} from "@shared/db.ts";
import { loadConfig } from "@shared/config.ts";
import { resolve } from "node:path";

const BOLD = "\x1b[1m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const RED = "\x1b[31m";
const DIM = "\x1b[2m";
const CYAN = "\x1b[36m";
const NC = "\x1b[0m";

const VALID_SUBCOMMANDS = ["list", "create", "run", "enable", "disable", "delete", "history"] as const;

export async function handleWorkflow(args: string[]): Promise<void> {
  const sub = args[0] as (typeof VALID_SUBCOMMANDS)[number] | undefined;

  if (!sub || !VALID_SUBCOMMANDS.includes(sub)) {
    console.log(`Usage:
  kent workflow list                   List all workflows
  kent workflow create <name>          Create a new workflow
  kent workflow run <name>             Manually trigger a workflow
  kent workflow enable <name>          Enable a workflow
  kent workflow disable <name>         Disable a workflow
  kent workflow delete <name>          Delete a workflow
  kent workflow history <name>         Show recent runs`);
    process.exit(1);
  }

  switch (sub) {
    case "list":
      workflowList();
      break;
    case "create":
      await workflowCreate(args.slice(1));
      break;
    case "run":
      await workflowRun(args.slice(1));
      break;
    case "enable":
      workflowToggle(args.slice(1), true);
      break;
    case "disable":
      workflowToggle(args.slice(1), false);
      break;
    case "delete":
      workflowDelete(args.slice(1));
      break;
    case "history":
      workflowHistory(args.slice(1));
      break;
  }
}

// ── List ──────────────────────────────────────────────────────────────────

function workflowList(): void {
  const workflows = listWorkflows();

  if (workflows.length === 0) {
    console.log("  No workflows yet. Create one with: kent workflow create <name>");
    return;
  }

  console.log(`\n${BOLD}  Workflows${NC}\n`);
  for (const wf of workflows) {
    const status = wf.enabled ? `${GREEN}enabled${NC}` : `${RED}disabled${NC}`;
    const schedule = wf.cron_schedule ? `${DIM}${wf.cron_schedule}${NC}` : `${DIM}${wf.type}${NC}`;
    const sourceTag = wf.source !== "user" ? ` ${DIM}[${wf.source}]${NC}` : "";
    const lastRun = wf.last_run_at
      ? `${DIM}last: ${new Date(wf.last_run_at * 1000).toLocaleString()}${NC}`
      : `${DIM}never run${NC}`;

    console.log(`  ${BOLD}${wf.name}${NC}  ${status}  ${schedule}${sourceTag}`);
    if (wf.description) {
      console.log(`    ${DIM}${wf.description}${NC}`);
    }
    console.log(`    ${lastRun}`);
    console.log();
  }
}

// ── Create ────────────────────────────────────────────────────────────────

async function workflowCreate(args: string[]): Promise<void> {
  const name = args[0];
  if (!name) {
    console.error("Usage: kent workflow create <name> [--cron \"0 9 * * *\"] [--prompt \"...\"]");
    process.exit(1);
  }

  // Check if already exists
  if (getWorkflow(name)) {
    console.error(`Workflow "${name}" already exists.`);
    process.exit(1);
  }

  // Parse flags
  let cron: string | undefined;
  let prompt: string | undefined;
  let description: string | undefined;

  for (let i = 1; i < args.length; i++) {
    if (args[i] === "--cron" && args[i + 1]) {
      cron = args[++i];
    } else if (args[i] === "--prompt" && args[i + 1]) {
      prompt = args[++i];
    } else if (args[i] === "--description" && args[i + 1]) {
      description = args[++i];
    }
  }

  // Interactive prompts if not provided via flags
  if (!prompt) {
    const rl = (await import("node:readline")).createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    const ask = (q: string): Promise<string> =>
      new Promise((resolve) => rl.question(q, (a) => resolve(a.trim())));

    if (!description) {
      description = await ask("  Description: ");
    }
    prompt = await ask("  Prompt (what should the agent do?): ");
    if (!cron) {
      const cronInput = await ask("  Cron schedule (e.g. '0 9 * * 1-5', or empty for manual): ");
      if (cronInput) cron = cronInput;
    }
    rl.close();
  }

  if (!prompt) {
    console.error("Prompt is required.");
    process.exit(1);
  }

  const id = createWorkflow({ name, prompt, description, cron_schedule: cron });
  console.log(`${GREEN}  ✓ Created workflow "${name}"${NC}`);
  if (cron) {
    console.log(`    Schedule: ${cron}`);
  } else {
    console.log(`    Trigger manually: kent workflow run ${name}`);
  }
}

// ── Run ───────────────────────────────────────────────────────────────────

async function workflowRun(args: string[]): Promise<void> {
  const name = args[0];
  if (!name) {
    console.error("Usage: kent workflow run <name>");
    process.exit(1);
  }

  const wf = getWorkflow(name);
  if (!wf) {
    console.error(`Workflow "${name}" not found.`);
    process.exit(1);
  }

  console.log(`${CYAN}  Running "${wf.name}"...${NC}`);

  const config = loadConfig();
  const threadId = createThread(`workflow: ${wf.name}`, { type: "workflow", workflow_id: wf.id });
  updateWorkflow(wf.id, { last_run_at: Math.floor(Date.now() / 1000) });

  const projectRoot = resolve(import.meta.dir, "../..");
  const agentPath = resolve(projectRoot, "agent", "agent.ts");
  const bunPath = process.execPath || "bun";

  const env: Record<string, string> = {
    ...process.env as Record<string, string>,
    ANTHROPIC_API_KEY: config.keys.anthropic || process.env.ANTHROPIC_API_KEY || "",
    RUNNER: "workflow",
    THREAD_ID: threadId,
    PROMPT: wf.prompt,
    MODEL: config.agent.default_model,
    MAX_TURNS: String(config.agent.max_turns),
  };

  const proc = Bun.spawn([bunPath, "run", agentPath], {
    env,
    stdout: "pipe",
    stderr: "inherit",
    cwd: projectRoot,
  });

  const stdout = await new Response(proc.stdout).text();
  await proc.exited;

  finishThread(threadId, proc.exitCode === 0 ? "done" : "error");

  if (proc.exitCode === 0) {
    console.log(`\n${stdout}`);
    console.log(`${GREEN}  ✓ Done${NC}`);
  } else {
    console.log(`\n${stdout}`);
    console.error(`${RED}  ✗ Failed (exit ${proc.exitCode})${NC}`);
  }
}

// ── Toggle ────────────────────────────────────────────────────────────────

function workflowToggle(args: string[], enabled: boolean): void {
  const name = args[0];
  if (!name) {
    console.error(`Usage: kent workflow ${enabled ? "enable" : "disable"} <name>`);
    process.exit(1);
  }

  const wf = getWorkflow(name);
  if (!wf) {
    console.error(`Workflow "${name}" not found.`);
    process.exit(1);
  }

  updateWorkflow(wf.id, { enabled: enabled ? 1 : 0 });
  const label = enabled ? `${GREEN}enabled${NC}` : `${RED}disabled${NC}`;
  console.log(`  ✓ Workflow "${wf.name}" ${label}`);
}

// ── Delete ────────────────────────────────────────────────────────────────

function workflowDelete(args: string[]): void {
  const name = args[0];
  if (!name) {
    console.error("Usage: kent workflow delete <name>");
    process.exit(1);
  }

  if (deleteWorkflow(name)) {
    console.log(`  ✓ Deleted workflow "${name}"`);
  } else {
    console.error(`Workflow "${name}" not found.`);
    process.exit(1);
  }
}

// ── History ───────────────────────────────────────────────────────────────

function workflowHistory(args: string[]): void {
  const name = args[0];
  if (!name) {
    console.error("Usage: kent workflow history <name>");
    process.exit(1);
  }

  const wf = getWorkflow(name);
  if (!wf) {
    console.error(`Workflow "${name}" not found.`);
    process.exit(1);
  }

  const runs = getWorkflowRuns(wf.id);

  if (runs.length === 0) {
    console.log(`  No runs yet for "${wf.name}".`);
    return;
  }

  console.log(`\n${BOLD}  Run history: ${wf.name}${NC}\n`);
  for (const run of runs) {
    const date = new Date((run.started_at ?? run.created_at) * 1000).toLocaleString();
    const statusIcon =
      run.status === "done" ? `${GREEN}✓${NC}` :
      run.status === "error" ? `${RED}✗${NC}` :
      run.status === "running" ? `${YELLOW}●${NC}` :
      `${DIM}○${NC}`;

    const duration = run.finished_at && run.started_at
      ? `${run.finished_at - run.started_at}s`
      : "...";

    console.log(`  ${statusIcon} ${date}  ${DIM}(${duration})${NC}`);

    // Show preview from last assistant message
    const msgs = getMessages(run.id, 200);
    const lastAssistant = [...msgs].reverse().find((m) => m.role === "assistant");
    if (lastAssistant) {
      const preview = lastAssistant.content.split("\n")[0]?.slice(0, 100) ?? "";
      console.log(`    ${DIM}${preview}${NC}`);
    }
    console.log();
  }
}
