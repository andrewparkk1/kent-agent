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
  type ModelProvider,
  KENT_DIR,
  CONFIG_PATH,
  PROMPTS_DIR,
  DEFAULT_CONFIG,
  saveConfig,
  ensureKentDir,
} from "@shared/config.ts";
import { SUGGESTED_MODELS, DEFAULT_LOCAL_BASE_URL, LOCAL_BASE_URLS } from "@shared/models.ts";
import { createWorkflow, listWorkflows } from "@shared/db.ts";
import { DEFAULT_WORKFLOWS } from "@shared/default-workflows.ts";

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
        // Move cursor up to start of the menu and clear everything below
        process.stdout.write(`\r\x1b[${totalLines - 1}A\x1b[0J`);
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
        process.stdout.write(`  ${pointer} ${check} ${label}${status}\x1b[K\n`);
      }
      process.stdout.write(`\n  ${DIM}↑/↓ move  ·  space toggle  ·  a select all  ·  enter confirm${NC}\x1b[K`);
    };

    // Pause readline so it doesn't swallow arrow key escape sequences
    rl.pause();

    draw();

    const stdin = process.stdin;
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf-8");

    const cleanup = () => {
      stdin.setRawMode(false);
      stdin.removeListener("data", onData);
      rl.resume();
    };

    const onData = (data: string) => {
      if (data === "\r" || data === "\n") {
        cleanup();
        process.stdout.write("\n\n");
        resolve(options);
        return;
      }

      if (data === "\x03") {
        cleanup();
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

// ---------------------------------------------------------------------------
// Interactive single-select (arrow keys to move, enter to confirm)
// ---------------------------------------------------------------------------

interface SingleSelectOption {
  label: string;
  key: string;
  status?: string;
  statusColor?: string;
}

function singleSelect(
  options: SingleSelectOption[],
  defaultIndex = 0,
): Promise<SingleSelectOption> {
  return new Promise((resolve) => {
    let cursor = defaultIndex;
    let drawn = false;

    const totalLines = options.length + 2;

    const draw = () => {
      if (drawn) {
        process.stdout.write(`\r\x1b[${totalLines - 1}A\x1b[0J`);
      }
      drawn = true;

      for (let i = 0; i < options.length; i++) {
        const opt = options[i]!;
        const pointer = i === cursor ? `${BOLD}❯${NC}` : " ";
        const radio = i === cursor ? `${GREEN}◉${NC}` : `${DIM}○${NC}`;
        const label = i === cursor ? `${BOLD}${opt.label}${NC}` : opt.label;
        const status = opt.status
          ? ` ${opt.statusColor || DIM}${opt.status}${NC}`
          : "";
        process.stdout.write(`  ${pointer} ${radio} ${label}${status}\x1b[K\n`);
      }
      process.stdout.write(`\n  ${DIM}↑/↓ move  ·  enter select${NC}\x1b[K`);
    };

    rl.pause();
    draw();

    const stdin = process.stdin;
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf-8");

    const cleanup = () => {
      stdin.setRawMode(false);
      stdin.removeListener("data", onData);
      rl.resume();
    };

    const onData = (data: string) => {
      if (data === "\r" || data === "\n") {
        cleanup();
        process.stdout.write("\n\n");
        resolve(options[cursor]!);
        return;
      }

      if (data === "\x03") {
        cleanup();
        process.stdout.write("\n");
        process.exit(0);
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

// Default workflows are defined in shared/default-workflows.ts

async function seedDefaultWorkflows(): Promise<void> {
  const existing = await listWorkflows();
  if (existing.length > 0) {
    info("  Workflows already exist (skipping seed)");
    return;
  }

  let count = 0;
  for (const wf of DEFAULT_WORKFLOWS) {
    try {
      await createWorkflow(wf);
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
      return { ok: false, message: "Apple Notes DB not found. Grant Full Disk Access to your terminal in System Settings > Privacy & Security." };
    },
  },
  {
    key: "ai_coding",
    label: "AI Coding (Claude Code + Codex)",
    check: async () => {
      const hasClaudeCode = existsSync(join(homedir(), ".claude/projects"));
      const hasCodex = existsSync(join(homedir(), ".codex/history.jsonl"));
      if (hasClaudeCode && hasCodex) return { ok: true, message: "Claude Code + Codex found" };
      if (hasClaudeCode) return { ok: true, message: "Claude Code found" };
      if (hasCodex) return { ok: true, message: "Codex found" };
      return { ok: false, message: "No Claude Code or Codex data found" };
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

  // ------------------------------------------------------------------
  // Pre-flight: Full Disk Access check
  // ------------------------------------------------------------------
  const imessageDb = join(homedir(), "Library/Messages/chat.db");
  const appleNotesDb = join(homedir(), "Library/Group Containers/group.com.apple.notes/NoteStore.sqlite");
  const needsFDA = !existsSync(imessageDb) || !existsSync(appleNotesDb);

  if (needsFDA) {
    console.log(`${YELLOW}${BOLD}  ⚠ Full Disk Access required${NC}\n`);
    info("Kent reads iMessage and Apple Notes databases, which require");
    info("Full Disk Access for your terminal app.\n");
    info(`${BOLD}To grant access:${NC}`);
    info(`  1. Open ${BOLD}System Settings > Privacy & Security > Full Disk Access${NC}`);
    info(`  2. Add your terminal app (Terminal, iTerm2, Warp, etc.)`);
    info("  3. Restart your terminal\n");
    info(`${DIM}You can continue setup now and grant access later — Kent will`);
    info(`skip iMessage/Apple Notes until access is granted.${NC}\n`);
  }

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
  // Step 2: AI Provider & Model
  // ------------------------------------------------------------------
  step(2, TOTAL_STEPS, "AI Provider & Model");
  info("Choose which AI provider to use. Kent supports cloud APIs and local models.\n");

  const providerOptions: SingleSelectOption[] = [
    { label: "Anthropic (Claude)", key: "anthropic", status: "recommended", statusColor: GREEN },
    { label: "OpenAI (GPT)", key: "openai" },
    { label: "OpenRouter (any model)", key: "openrouter", status: "access 200+ models", statusColor: DIM },
    { label: "Google (Gemini)", key: "google" },
    { label: "Local (Ollama, LM Studio, llama.cpp)", key: "local", status: "runs on your machine", statusColor: CYAN },
    { label: "Custom (OpenAI-compatible endpoint)", key: "custom" },
  ];

  const chosenProvider = await singleSelect(providerOptions);
  const provider: ModelProvider = (chosenProvider.key as ModelProvider) || "anthropic";
  config.agent.provider = provider;

  // --- Collect API key or connection details based on provider ---
  switch (provider) {
    case "anthropic": {
      const key = await ask("Anthropic API key (sk-ant-...)", "");
      if (key) {
        config.keys.anthropic = key;
        success("Anthropic key saved");
      } else {
        warn("No key provided. Set ANTHROPIC_API_KEY env var or add to ~/.kent/config.json");
      }
      break;
    }
    case "openai": {
      const key = await ask("OpenAI API key (sk-...)", "");
      if (key) {
        config.keys.openai = key;
        success("OpenAI key saved");
      } else {
        warn("No key provided. Set OPENAI_API_KEY env var or add to ~/.kent/config.json");
      }
      break;
    }
    case "openrouter": {
      const key = await ask("OpenRouter API key (sk-or-...)", "");
      if (key) {
        config.keys.openrouter = key;
        success("OpenRouter key saved");
      } else {
        warn("No key provided. Set OPENROUTER_API_KEY env var or add to ~/.kent/config.json");
      }
      break;
    }
    case "google": {
      const key = await ask("Google API key", "");
      if (key) {
        config.keys.google = key;
        success("Google key saved");
      } else {
        warn("No key provided. Set GOOGLE_API_KEY env var or add to ~/.kent/config.json");
      }
      break;
    }
    case "local": {
      config.agent.base_url = DEFAULT_LOCAL_BASE_URL;
      success(`Using Ollama (${DEFAULT_LOCAL_BASE_URL})`);
      break;
    }
    case "custom": {
      info("Enter the base URL for your OpenAI-compatible API endpoint.\n");
      const baseUrl = await ask("Base URL (e.g. https://my-api.example.com/v1)", "");
      if (!baseUrl) {
        warn("No base URL provided. Set it in ~/.kent/config.json under agent.base_url");
      } else {
        config.agent.base_url = baseUrl;
        success(`Base URL: ${baseUrl}`);
      }
      console.log("");
      const apiKey = await ask("API key (optional, press enter to skip)", "");
      if (apiKey) {
        config.agent.api_key = apiKey;
        success("API key saved");
      }
      break;
    }
  }

  // --- Model selection (interactive dropdown) ---
  console.log("");
  const suggested = SUGGESTED_MODELS[provider];
  if (suggested.length > 0) {
    info("Choose a model:\n");
    const modelOptions: SingleSelectOption[] = suggested.map((s, i) => ({
      label: s.label,
      key: s.id,
      status: i === 0 ? "default" : undefined,
      statusColor: i === 0 ? GREEN : undefined,
    }));
    // Add "Other (type manually)" option
    modelOptions.push({ label: "Other (enter model ID manually)", key: "__custom__", status: undefined });
    const chosenModel = await singleSelect(modelOptions);
    if (chosenModel.key === "__custom__") {
      const customModel = await ask("Model ID", suggested[0]!.id);
      config.agent.default_model = customModel;
    } else {
      config.agent.default_model = chosenModel.key;
    }
  } else {
    const customModel = await ask("Model ID", "");
    config.agent.default_model = customModel;
  }
  success(`Model: ${config.agent.default_model} (${provider})`);

  // --- For local provider: check Ollama is installed and model is pulled ---
  if (provider === "local") {
    let hasOllama = await commandExists("ollama");
    if (!hasOllama) {
      warn("Ollama is not installed.");
      const shouldInstall = await confirm("Install Ollama now?", true);
      if (shouldInstall) {
        info("  Installing Ollama...\n");
        const installProc = Bun.spawn(["brew", "install", "ollama"], {
          stdout: "inherit", stderr: "inherit",
        });
        const code = await installProc.exited;
        if (code === 0) {
          success("Ollama installed");
          hasOllama = true;
        } else {
          warn("Could not install via brew. Visit https://ollama.com to install manually.");
          info(`  Then run: ${BOLD}ollama pull ${config.agent.default_model}${NC}\n`);
        }
      } else {
        info(`  Install later: ${BOLD}brew install ollama${NC} or visit ${DIM}https://ollama.com${NC}`);
        info(`  Then run: ${BOLD}ollama pull ${config.agent.default_model}${NC}\n`);
      }
    }
    if (hasOllama) {
      success("Ollama is installed");
      // Check if the selected model is already pulled
      try {
        const proc = Bun.spawn(["ollama", "list"], { stdout: "pipe", stderr: "pipe" });
        const output = await new Response(proc.stdout).text();
        await proc.exited;
        const modelName = config.agent.default_model.split(":")[0]!;
        const isInstalled = output.split("\n").some((line) =>
          line.toLowerCase().startsWith(config.agent.default_model.toLowerCase()) ||
          line.toLowerCase().startsWith(modelName.toLowerCase())
        );
        if (isInstalled) {
          success(`Model ${config.agent.default_model} is already pulled`);
        } else {
          warn(`Model ${config.agent.default_model} is not pulled yet.`);
          const shouldPull = await confirm(`Pull ${config.agent.default_model} now?`, true);
          if (shouldPull) {
            info(`  Pulling ${config.agent.default_model}... (this may take a while)\n`);
            const pullProc = Bun.spawn(["ollama", "pull", config.agent.default_model], {
              stdout: "inherit", stderr: "inherit",
            });
            const code = await pullProc.exited;
            if (code === 0) {
              success(`Model ${config.agent.default_model} pulled successfully`);
            } else {
              warn(`Failed to pull model. Run 'ollama pull ${config.agent.default_model}' later.`);
            }
          } else {
            info(`  Run ${BOLD}ollama pull ${config.agent.default_model}${NC} before using Kent.`);
          }
        }
      } catch {
        warn("Could not check installed models. Make sure Ollama is running.");
      }
    }
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
  step(4, TOTAL_STEPS, "Initial Sync");

  // Save config first
  saveConfig(config);
  success(`Config saved to ${CONFIG_PATH}`);

  // Seed default workflows
  await seedDefaultWorkflows();

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

  ${BOLD}Next step:${NC}
    kent run                ${DIM}# start daemon + web dashboard${NC}

  ${BOLD}Other commands:${NC}
    kent status             ${DIM}# check if services are running${NC}
    kent logs -f            ${DIM}# stream daemon logs${NC}
    kent sync               ${DIM}# manual sync${NC}
    kent workflow list      ${DIM}# see scheduled workflows${NC}

  ${DIM}Config:  ~/.kent/config.json${NC}
  ${DIM}Data:    ~/.kent/kent.db${NC}
  ${DIM}Logs:    ~/.kent/daemon.log${NC}
`);

  process.exit(0);
}
