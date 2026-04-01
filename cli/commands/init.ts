/** Interactive setup wizard — configures API keys, source toggles, OAuth, and starts the daemon. */
/**
 * `kent init` — interactive setup wizard that runs on first use.
 * Walks through: generate device token, set API keys, pick which sources to enable
 * (with live prerequisite checks like "is Signal installed?"), run OAuth for Gmail/GitHub,
 * install bundled prompt files to ~/.kent/prompts/, start the daemon, and do an initial sync.
 */
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import { createInterface } from "node:readline";
import {
  type Config,
  KENT_DIR,
  CONFIG_PATH,
  PROMPTS_DIR,
  DEFAULT_CONFIG,
  saveConfig,
  ensureKentDir,
} from "@shared/config.ts";
import { createWorkflow, listWorkflows } from "@shared/db.ts";
import { daemonStart } from "./daemon.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const BOLD = "\x1b[1m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const RED = "\x1b[31m";
const DIM = "\x1b[2m";
const CYAN = "\x1b[36m";
const NC = "\x1b[0m";

function success(msg: string) { console.log(`${GREEN}  ✓ ${msg}${NC}`); }
function warn(msg: string) { console.log(`${YELLOW}  ⚠ ${msg}${NC}`); }
function error(msg: string) { console.log(`${RED}  ✗ ${msg}${NC}`); }
function info(msg: string) { console.log(`  ${msg}`); }
function step(n: number, total: number, label: string) {
  console.log(`\n${BOLD}  [${n}/${total}] ${label}${NC}`);
}

const rl = createInterface({ input: process.stdin, output: process.stdout });

function ask(question: string, defaultValue = ""): Promise<string> {
  const suffix = defaultValue ? ` ${DIM}(${defaultValue})${NC}` : "";
  return new Promise((resolve) => {
    rl.question(`  ${question}${suffix}: `, (answer) => {
      resolve(answer.trim() || defaultValue);
    });
  });
}

function confirm(question: string, defaultYes = true): Promise<boolean> {
  const hint = defaultYes ? "Y/n" : "y/N";
  return new Promise((resolve) => {
    rl.question(`  ${question} [${hint}]: `, (answer) => {
      const a = answer.trim().toLowerCase();
      if (a === "") resolve(defaultYes);
      else resolve(a === "y" || a === "yes");
    });
  });
}

// ---------------------------------------------------------------------------
// Interactive multi-select (spacebar to toggle, enter to confirm)
// ---------------------------------------------------------------------------

interface SelectOption {
  label: string;
  key: string;
  selected: boolean;
  status?: string;
  statusColor?: string;
}

function multiSelect(
  _title: string,
  options: SelectOption[],
): Promise<SelectOption[]> {
  return new Promise((resolve) => {
    let cursor = 0;
    let drawn = false;

    const totalLines = options.length + 2;

    const draw = () => {
      if (drawn) {
        process.stdout.write(`\x1b[${totalLines}F`);
        process.stdout.write(`\x1b[0J`);
      }
      drawn = true;

      for (let i = 0; i < options.length; i++) {
        const opt = options[i]!;
        const pointer = i === cursor ? `${BOLD}❯${NC}` : " ";
        const check = opt.selected ? `${GREEN}◉${NC}` : `${DIM}○${NC}`;
        const label = i === cursor ? `${BOLD}${opt.label}${NC}` : opt.label;
        const status = opt.status
          ? ` ${opt.statusColor || DIM}${opt.status}${NC}`
          : "";
        process.stdout.write(`  ${pointer} ${check} ${label}${status}\n`);
      }
      process.stdout.write(`\n  ${DIM}↑/↓ move  ·  space toggle  ·  a select all  ·  enter confirm${NC}`);
    };

    draw();

    const stdin = process.stdin;
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf-8");

    const onData = (data: string) => {
      if (data === "\r" || data === "\n") {
        stdin.setRawMode(false);
        stdin.removeListener("data", onData);
        process.stdout.write("\n\n");
        resolve(options);
        return;
      }

      if (data === "\x03") {
        stdin.setRawMode(false);
        stdin.removeListener("data", onData);
        process.stdout.write("\n");
        process.exit(0);
      }

      if (data === " ") {
        options[cursor]!.selected = !options[cursor]!.selected;
        draw();
        return;
      }

      if (data === "\x1b[A" || data === "k") {
        cursor = (cursor - 1 + options.length) % options.length;
        draw();
        return;
      }
      if (data === "\x1b[B" || data === "j") {
        cursor = (cursor + 1) % options.length;
        draw();
        return;
      }

      if (data === "a") {
        const allSelected = options.every((o) => o.selected);
        for (const opt of options) opt.selected = !allSelected;
        draw();
        return;
      }
    };

    stdin.on("data", onData);
  });
}

function printHeader(): void {
  console.log(`
${BOLD}  _  __          _
 | |/ /___ _ __ | |_
 | ' // _ \\ '_ \\| __|
 | . \\  __/ | | | |_
 |_|\\_\\___|_| |_|\\__|${NC}

  ${DIM}Personal AI Agent — Setup Wizard${NC}
`);
}

// ---------------------------------------------------------------------------
// Install bundled prompts to ~/.kent/prompts/
// ---------------------------------------------------------------------------

function installPrompts(): void {
  const bundledDir = join(dirname(import.meta.path), "..", "..", "agent", "prompts");

  if (!existsSync(bundledDir)) {
    warn("Bundled prompts not found — skipping prompt install");
    return;
  }

  mkdirSync(PROMPTS_DIR, { recursive: true });
  mkdirSync(join(PROMPTS_DIR, "skills"), { recursive: true });

  let copied = 0;

  // Copy top-level prompt files
  for (const name of readdirSync(bundledDir)) {
    const srcPath = join(bundledDir, name);

    if (name === "skills") {
      // Copy nested skill directories: skills/<name>/SKILL.md
      const skillsSrc = join(bundledDir, "skills");
      for (const skillName of readdirSync(skillsSrc)) {
        const skillPath = join(skillsSrc, skillName);
        if (statSync(skillPath).isDirectory()) {
          // Nested: skills/<name>/SKILL.md (+ any supporting .md files)
          const destDir = join(PROMPTS_DIR, "skills", skillName);
          mkdirSync(destDir, { recursive: true });
          for (const file of readdirSync(skillPath)) {
            if (!file.endsWith(".md")) continue;
            const dest = join(destDir, file);
            if (!existsSync(dest)) {
              writeFileSync(dest, readFileSync(join(skillPath, file), "utf-8"), "utf-8");
              copied++;
            }
          }
        } else if (skillName.endsWith(".md")) {
          // Legacy flat: skills/<name>.md
          const dest = join(PROMPTS_DIR, "skills", skillName);
          if (!existsSync(dest)) {
            writeFileSync(dest, readFileSync(skillPath, "utf-8"), "utf-8");
            copied++;
          }
        }
      }
    } else if (name.endsWith(".md")) {
      const destPath = join(PROMPTS_DIR, name);
      if (!existsSync(destPath)) {
        writeFileSync(destPath, readFileSync(srcPath, "utf-8"), "utf-8");
        copied++;
      }
    }
  }

  if (copied > 0) {
    success(`Installed ${copied} prompt files to ~/.kent/prompts/`);
  } else {
    info("  Prompts already installed (skipped existing files)");
  }
}

// ---------------------------------------------------------------------------
// Seed default workflows into SQLite
// ---------------------------------------------------------------------------

const DEFAULT_WORKFLOWS = [
  {
    name: "morning-briefing",
    description: "Daily morning briefing — calendar, emails, to-dos",
    cron_schedule: "0 8 * * *",
    source: "default" as const,
    prompt: `Daily briefing. Use EXACTLY these markdown headings. Each section is 1-2 sentences max — warm, direct, like a friend catching you up.

CRITICAL — Temporal awareness:
- You receive 7 days of source data, but this brief is about TODAY and the near future.
- Past run summaries show what was already reported. Do NOT repeat items from past briefs unless there is NEW information.
- For to-dos: only include tasks where there is fresh evidence they are still open (new email, upcoming deadline, unresolved thread). If a task appeared in a past brief and there is no new signal, DROP IT — assume it was handled.
- If something looks completed based on the data (confirmation email, reservation made, form submitted), do not list it as a to-do.

## Today
One sentence on what's happening today. Meetings, events, or "clear day." If meetings have prereads, docs, or links attached — mention them.

## Prep
If today has meetings with agendas, prereads, or shared docs — list them briefly so I can prepare. If nothing needs prep, skip this section entirely.

## Upcoming week
2-3 sentences max on the most important things coming up this week. Mention names, times, conflicts.

## Emails
The most important 1-2 emails that need attention. Include anything time-sensitive (bills, invoices, deadlines, renewals, payments due).

## People
One sentence about who you should follow up with or who reached out recently. Names only.

## Rewind
1-2 sentences looking back at your past week — what happened, key meetings, decisions made, themes.

## To-do
3-5 actionable items as bullets. Include:
- Follow-ups from meetings or messages
- Bills, payments, or deadlines approaching (from emails or calendar)
- Anything that'll slip through the cracks if not done today
Format: - **Task title** — brief context

Warm, short, direct.`,
  },
  {
    name: "evening-recap",
    description: "End-of-day recap — what happened, what's tomorrow",
    cron_schedule: "0 19 * * *",
    source: "default" as const,
    prompt: `Evening recap. Use EXACTLY these markdown headings. Each section 1-2 sentences max — warm, direct.

CRITICAL — Temporal awareness:
- You receive 7 days of source data, but this brief is about TODAY only.
- "Today" means the current calendar date. Only report meetings, emails, and events that actually happened or arrived today.
- Past run summaries show what was already reported on previous days. Do NOT repeat items from past briefs unless there is NEW activity today.
- For to-dos: only include tasks where there is fresh evidence TODAY that they are still open (new email, upcoming deadline, unresolved thread). If a task appeared in a past brief and there is no new signal today, DROP IT — assume it was handled.
- If something looks completed based on the data (confirmation email sent, reservation made, form submitted), do not list it as a to-do.

## Today
What happened today in 2-3 sentences. Key meetings, decisions, accomplishments. Names and outcomes.

## Highlights
1-2 standout moments or wins from today. Could be a good conversation, a breakthrough, or something notable.

## Emails
Any emails that came in today that still need attention or were important. Include bills, invoices, or deadlines spotted. One sentence. If none, skip this section entirely.

## Tomorrow
Quick preview of tomorrow — meetings, prereads to review tonight, deadlines landing. If tomorrow is clear, say so.

## To-do
Follow-ups from today + prep for tomorrow as bullets. Format: - **Task title** — brief context.

IMPORTANT — Deduplicate and filter tasks:
- If two items refer to the same assignment, class, or task (even with different wording, abbreviations, or course codes), merge them into ONE bullet
- Prefer the version with the most specific deadline info
- Never list the same underlying task twice
- Do NOT carry forward stale to-dos from past briefs — only include items with fresh evidence they are still pending

Short, warm, direct.`,
  },
  {
    name: "memory-curator",
    description: "Maintain a living knowledge base of useful context",
    cron_schedule: "0 10 * * *",
    source: "default" as const,
    prompt: `You are the memory curator. Your job is to maintain a living knowledge base of things that are genuinely useful — the kind of context a great assistant would want to remember to help you better.

Review the data sources provided (emails, messages, meetings, calendar, notes). Focus on things that would actually help in future conversations.

Look for and surface:
- **People**: who they are to you, what you're working on together, how you interact
- **Projects**: what you're building or working on, current state, what's next, key decisions
- **Plans**: upcoming trips, deadlines, commitments, events worth remembering
- **Preferences**: how you like things done, tools you use, patterns in how you work
- **Topics**: things you're actively thinking about, learning, or exploring

Guidelines:
- Keep each observation to 2-5 sentences — concise, factual, useful
- The test for a good memory: "Would this help me assist you better next time?" If not, don't save it.
- Update existing observations rather than creating duplicates
- Flag anything that seems stale (30+ days with no new activity)

DO NOT save:
- Security observations or warnings about what's in your files/notes
- Browsing patterns, screen time analysis, or attention tracking
- Judgmental observations about habits or behavior
- Anything that reads like a report ABOUT you rather than notes FOR you
- Obvious things that can be found by reading your calendar or inbox directly`,
  },
  {
    name: "workflow-suggestor",
    description: "Suggest new automations based on actual patterns",
    cron_schedule: "30 9 * * *",
    source: "default" as const,
    prompt: `You have access to this person's digital life — their emails, calendar, messages, and more. Suggest 1-3 new automated workflows that would save them real time and effort.

Don't suggest passive summaries or information digests. Suggest workflows that ACTUALLY DO THINGS:
- Draft follow-up emails after meetings
- Create calendar events when someone suggests a time in a message
- File and organize emails automatically
- Send birthday messages to contacts
- Draft responses to common email patterns
- Set reminders, update docs

Think: "What would a world-class executive assistant do automatically without being asked?"

Look at their actual data. What are they spending time on that could be automated? What falls through the cracks? What's repetitive?

For each suggestion, provide:
- **Name**: short, descriptive
- **Schedule**: cron expression or "event-triggered"
- **What it does**: 1-2 sentences
- **Why**: reference actual patterns you see in their data (names, times, frequencies)
- **Prompt**: the full detailed instructions the agent would receive when the workflow runs

Rules:
- Only suggest things that would actually help based on the data you see
- Don't suggest workflows that already exist
- Be specific — reference actual patterns (names, times, frequencies)
- Each suggested prompt should instruct the agent to DO something concrete, not just summarize
- Keep it to 1-3 high-quality suggestions, not a laundry list`,
  },
];

function seedDefaultWorkflows(): void {
  const existing = listWorkflows();
  if (existing.length > 0) {
    info("  Workflows already exist (skipping seed)");
    return;
  }

  let count = 0;
  for (const wf of DEFAULT_WORKFLOWS) {
    try {
      createWorkflow(wf);
      count++;
    } catch {
      // Duplicate name — skip
    }
  }

  if (count > 0) {
    success(`Created ${count} default workflows`);
    for (const wf of DEFAULT_WORKFLOWS) {
      info(`    ${CYAN}${wf.name}${NC} — ${wf.description} ${DIM}(${wf.cron_schedule})${NC}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Source prerequisite checks
// ---------------------------------------------------------------------------

async function commandExists(cmd: string): Promise<boolean> {
  try {
    const proc = Bun.spawn(["which", cmd], { stdout: "pipe", stderr: "pipe" });
    return (await proc.exited) === 0;
  } catch {
    return false;
  }
}

interface SourceInfo {
  key: keyof Config["sources"];
  label: string;
  check: () => Promise<{ ok: boolean; message: string }>;
  collectCreds?: () => Promise<Record<string, string>>;
}

const SOURCES: SourceInfo[] = [
  {
    key: "imessage",
    label: "iMessage",
    check: async () => {
      const dbPath = join(homedir(), "Library/Messages/chat.db");
      if (existsSync(dbPath)) return { ok: true, message: "chat.db found" };
      return { ok: false, message: "chat.db not found. Grant Full Disk Access to your terminal in System Settings > Privacy & Security." };
    },
  },
  {
    key: "signal",
    label: "Signal",
    check: async () => {
      const dbPath = join(homedir(), "Library/Application Support/Signal/sql/db.sqlite");
      if (!existsSync(dbPath)) return { ok: false, message: "Signal desktop not installed or no database found." };
      const hasSqlcipher = await commandExists("sqlcipher");
      if (!hasSqlcipher) return { ok: false, message: "Requires sqlcipher. Fix: brew install sqlcipher" };
      return { ok: true, message: "Signal DB + sqlcipher found" };
    },
  },
  {
    key: "granola",
    label: "Granola",
    check: async () => {
      const dir = join(homedir(), "Library/Application Support/Granola");
      if (existsSync(dir)) return { ok: true, message: "Granola directory found" };
      return { ok: false, message: "Granola not installed. Download from https://granola.ai" };
    },
  },
  {
    key: "gmail",
    label: "Google (Gmail, Calendar, Tasks, Drive)",
    check: async () => {
      const hasGws = await commandExists("gws");
      if (!hasGws) return { ok: false, message: "gws CLI not installed" };
      try {
        const proc = Bun.spawn(["gws", "auth", "status", "--format", "json"], { stdout: "pipe", stderr: "pipe" });
        const code = await proc.exited;
        if (code === 0) {
          const output = await new Response(proc.stdout).text();
          const status = JSON.parse(output);
          if (status.token_valid) return { ok: true, message: `authenticated as ${status.user}` };
          return { ok: true, message: "gws found (needs auth)" };
        }
      } catch { }
      return { ok: true, message: "gws found (needs setup)" };
    },
    collectCreds: async () => {
      const hasGws = await commandExists("gws");
      if (!hasGws) {
        info("Installing gws CLI...");
        const installProc = Bun.spawn(["brew", "install", "gws"], {
          stdout: "inherit", stderr: "inherit",
        });
        if ((await installProc.exited) !== 0) {
          warn("Could not install gws. Install manually: brew install gws");
          return {};
        }
      }

      try {
        const statusProc = Bun.spawn(["gws", "auth", "status"], { stdout: "pipe", stderr: "pipe" });
        const statusOutput = await new Response(statusProc.stdout).text();
        if ((await statusProc.exited) === 0) {
          try {
            const status = JSON.parse(statusOutput);
            if (status.token_valid) {
              success(`Gmail: authenticated as ${status.user}`);
              return {};
            }
          } catch { }
        }
      } catch { }

      const hasCredentials = existsSync(
        join(homedir(), "Library/Application Support/gws/client_secret.json")
      ) || existsSync(
        join(homedir(), "Library/Application Support/gws/credentials.enc")
      );

      if (!hasCredentials) {
        info("Gmail requires a Google Cloud OAuth setup (one-time).");
        info("This will create a GCP project and OAuth client automatically.\n");
        const setupProc = Bun.spawn(["gws", "auth", "setup", "--login"], {
          stdout: "inherit", stderr: "inherit", stdin: "inherit",
        });
        const code = await setupProc.exited;
        if (code === 0) {
          success("Gmail: GCP project + OAuth set up and authenticated");
        } else {
          warn("Gmail setup incomplete. Run 'gws auth setup --login' later.");
        }
        return {};
      }

      info("Opening Gmail OAuth in your browser...");
      const authProc = Bun.spawn(["gws", "auth", "login", "-s", "gmail,calendar,tasks,drive"], {
        stdout: "inherit", stderr: "inherit", stdin: "inherit",
      });
      const code = await authProc.exited;
      if (code === 0) {
        success("Gmail: authenticated");
      } else {
        warn("Gmail auth failed. Run 'gws auth login -s gmail,calendar,tasks' later.");
      }
      return {};
    },
  },
  {
    key: "github",
    label: "GitHub",
    check: async () => {
      const hasGh = await commandExists("gh");
      if (!hasGh) return { ok: false, message: "gh CLI not installed" };
      try {
        const proc = Bun.spawn(["gh", "auth", "status"], { stdout: "pipe", stderr: "pipe" });
        const code = await proc.exited;
        if (code === 0) {
          const output = await new Response(proc.stderr).text();
          const match = output.match(/Logged in to .+ as (.+)/);
          const user = match?.[1] ?? "✓";
          return { ok: true, message: `authenticated as ${user}` };
        }
      } catch { }
      return { ok: true, message: "gh found (needs auth)" };
    },
    collectCreds: async () => {
      const hasGh = await commandExists("gh");
      if (!hasGh) {
        info("Installing GitHub CLI...");
        const installProc = Bun.spawn(["brew", "install", "gh"], {
          stdout: "inherit", stderr: "inherit",
        });
        if ((await installProc.exited) !== 0) {
          warn("Could not install gh. Install manually: brew install gh");
          return {};
        }
      }

      try {
        const checkProc = Bun.spawn(["gh", "auth", "status"], { stdout: "pipe", stderr: "pipe" });
        if ((await checkProc.exited) === 0) {
          success("GitHub: already authenticated");
          return {};
        }
      } catch { }

      info("Opening GitHub OAuth in your browser...");
      const authProc = Bun.spawn(["gh", "auth", "login", "--web", "-p", "https"], {
        stdout: "inherit", stderr: "inherit", stdin: "inherit",
      });
      const code = await authProc.exited;
      if (code === 0) {
        success("GitHub: authenticated");
      } else {
        warn("GitHub auth failed. Run 'gh auth login' later.");
      }
      return {};
    },
  },
  {
    key: "chrome",
    label: "Chrome History",
    check: async () => {
      const dbPath = join(homedir(), "Library/Application Support/Google/Chrome/Default/History");
      if (existsSync(dbPath)) return { ok: true, message: "Chrome history DB found" };
      return { ok: false, message: "Chrome history not found. Is Chrome installed?" };
    },
  },
  {
    key: "apple_notes",
    label: "Apple Notes",
    check: async () => {
      const dbPath = join(homedir(), "Library/Group Containers/group.com.apple.notes/NoteStore.sqlite");
      if (existsSync(dbPath)) return { ok: true, message: "NoteStore.sqlite found" };
      return { ok: false, message: "Apple Notes DB not found. Grant Full Disk Access to your terminal." };
    },
  },
];

// ---------------------------------------------------------------------------
// Main init flow
// ---------------------------------------------------------------------------

export async function handleInit(): Promise<void> {
  printHeader();

  // Check if already initialized
  if (existsSync(CONFIG_PATH)) {
    const reinit = await confirm("Kent is already initialized. Re-run setup?", false);
    if (!reinit) {
      info("Exiting. Your existing config is unchanged.");
      rl.close();
      return;
    }
  }

  const config: Config = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
  const TOTAL_STEPS = 4;

  // ------------------------------------------------------------------
  // Step 1: Device Token
  // ------------------------------------------------------------------
  step(1, TOTAL_STEPS, "Device Token");
  const deviceToken = randomBytes(32).toString("base64url");
  config.core.device_token = deviceToken;
  success(`Generated device token: ${deviceToken.slice(0, 12)}...`);
  ensureKentDir();

  // Copy bundled prompts to ~/.kent/prompts/
  installPrompts();

  // ------------------------------------------------------------------
  // Step 2: AI Provider
  // ------------------------------------------------------------------
  step(2, TOTAL_STEPS, "AI Provider");
  info("Kent needs an API key to run the agent.\n");

  const anthropicKey = await ask("Anthropic API key (sk-ant-...)", "");
  if (anthropicKey) {
    config.keys.anthropic = anthropicKey;
    success("Anthropic key saved");
  } else {
    warn("No Anthropic key provided. Set ANTHROPIC_API_KEY env var or add to ~/.kent/config.json");
  }

  console.log("");
  const openaiKey = await ask("OpenAI API key (optional, press enter to skip)", "");
  if (openaiKey) {
    config.keys.openai = openaiKey;
    success("OpenAI key saved");
  }

  // ------------------------------------------------------------------
  // Step 3: Sources (interactive multi-select)
  // ------------------------------------------------------------------
  step(3, TOTAL_STEPS, "Sources");
  info("Select which sources to enable. Kent will sync data from these.\n");

  const sourceChecks = await Promise.all(
    SOURCES.map(async (s) => {
      const result = await s.check();
      return { source: s, check: result };
    }),
  );

  const selectOptions: SelectOption[] = sourceChecks.map(({ source, check }) => ({
    label: source.label,
    key: source.key,
    selected: check.ok,
    status: check.ok ? `✓ ${check.message}` : `⚠ ${check.message}`,
    statusColor: check.ok ? GREEN : YELLOW,
  }));

  const selectedOptions = await multiSelect("Sources", selectOptions);

  const enabledSources: SourceInfo[] = [];
  for (const opt of selectedOptions) {
    const sourceInfo = SOURCES.find((s) => s.key === opt.key)!;
    if (opt.selected) {
      config.sources[sourceInfo.key] = true;
      enabledSources.push(sourceInfo);
      // Gmail also enables Google Calendar + Tasks + Drive (same gws CLI)
      if (sourceInfo.key === "gmail") {
        config.sources.gcal = true;
        config.sources.gtasks = true;
        config.sources.gdrive = true;
      }
    } else {
      config.sources[sourceInfo.key] = false;
      if (sourceInfo.key === "gmail") {
        config.sources.gcal = false;
        config.sources.gtasks = false;
        config.sources.gdrive = false;
      }
    }
  }

  const enabledCount = enabledSources.length;
  success(`${enabledCount} source(s) enabled`);

  // Collect any source-specific credentials
  for (const source of enabledSources) {
    if (source.collectCreds) {
      await source.collectCreds();
    }
  }

  // ------------------------------------------------------------------
  // Step 4: Start Daemon
  // ------------------------------------------------------------------
  step(4, TOTAL_STEPS, "Start Daemon");

  // Save config first
  saveConfig(config);
  success(`Config saved to ${CONFIG_PATH}`);

  // Seed default workflows
  seedDefaultWorkflows();

  // Install and start launchd daemon
  try {
    await daemonStart();
    success("Daemon started");
  } catch (e) {
    warn(`Daemon setup failed: ${e}`);
    info("Start manually: kent daemon start");
  }

  // Run initial sync in-process so output streams live
  info("Running initial sync...\n");
  try {
    const { handleSync } = await import("./sync.ts");
    // Prevent handleSync's process.exit from killing init
    const originalExit = process.exit;
    process.exit = (() => {}) as never;
    try {
      await handleSync([]);
    } finally {
      process.exit = originalExit;
    }
    success("Initial sync complete");
  } catch (e) {
    warn(`Sync failed: ${e instanceof Error ? e.message : e}. Run 'kent sync' to retry.`);
  }

  // ------------------------------------------------------------------
  // Done
  // ------------------------------------------------------------------
  rl.close();

  console.log(`
${GREEN}${BOLD}  Setup complete!${NC}

  ${BOLD}Try:${NC}
    kent                    ${DIM}# interactive REPL${NC}
    kent sync               ${DIM}# manual sync${NC}
    kent daemon status      ${DIM}# check daemon${NC}
    kent workflow list       ${DIM}# see scheduled workflows${NC}

  ${DIM}Config:  ~/.kent/config.json${NC}
  ${DIM}Data:    ~/.kent/kent.db${NC}
  ${DIM}Prompts: ~/.kent/prompts/${NC}
  ${DIM}Logs:    ~/.kent/daemon.log${NC}
`);
}
