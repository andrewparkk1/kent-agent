/** Interactive setup wizard — configures API keys, source toggles, OAuth, and starts the daemon. */
/**
 * `kent init` — interactive setup wizard that runs on first use.
 * Walks through: generate device token, set API keys, pick which sources to enable
 * (with live prerequisite checks like "is Signal installed?"), run OAuth for Gmail/GitHub,
 * install bundled prompt files to ~/.kent/prompts/, start the daemon, and do an initial sync.
 */
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
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

  // Resolve to absolute in case of symlinks
  const resolvedBundled = join(bundledDir);

  if (!existsSync(resolvedBundled)) {
    warn("Bundled prompts not found — skipping prompt install");
    return;
  }

  mkdirSync(PROMPTS_DIR, { recursive: true });
  mkdirSync(join(PROMPTS_DIR, "skills"), { recursive: true });

  let copied = 0;

  // Copy top-level prompt files
  for (const name of readdirSync(resolvedBundled)) {
    const srcPath = join(resolvedBundled, name);
    const destPath = join(PROMPTS_DIR, name);

    if (name === "skills") {
      // Copy skills subdirectory
      const skillsSrc = join(resolvedBundled, "skills");
      for (const skillFile of readdirSync(skillsSrc)) {
        if (!skillFile.endsWith(".md")) continue;
        const skillSrc = join(skillsSrc, skillFile);
        const skillDest = join(PROMPTS_DIR, "skills", skillFile);
        if (!existsSync(skillDest)) {
          writeFileSync(skillDest, readFileSync(skillSrc, "utf-8"), "utf-8");
          copied++;
        }
      }
    } else if (name.endsWith(".md")) {
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

  ${DIM}Config: ~/.kent/config.json${NC}
  ${DIM}Data: ~/.kent/kent.db${NC}
  ${DIM}Logs: ~/.kent/daemon.log${NC}
`);
}
