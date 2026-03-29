import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync, readFileSync, copyFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { createInterface } from "node:readline";
import {
  type Config,
  KENT_DIR,
  CONFIG_PATH,
  PLIST_PATH,
  DEFAULT_CONFIG,
  loadConfig,
  saveConfig,
  ensureKentDir,
} from "@shared/config.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const BOLD = "\x1b[1m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const RED = "\x1b[31m";
const DIM = "\x1b[2m";
const NC = "\x1b[0m";

function success(msg: string) { console.log(`${GREEN}  ✓ ${msg}${NC}`); }
function warn(msg: string) { console.log(`${YELLOW}  ⚠ ${msg}${NC}`); }
function error(msg: string) { console.log(`${RED}  ✗ ${msg}${NC}`); }
function info(msg: string) { console.log(`  ${msg}`); }
function step(n: number, label: string) {
  console.log(`\n${BOLD}  [${n}/11] ${label}${NC}`);
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
  title: string,
  options: SelectOption[],
): Promise<SelectOption[]> {
  return new Promise((resolve) => {
    let cursor = 0;

    const render = () => {
      // Move cursor up to clear previous render (except first render)
      const totalLines = options.length + 2; // options + instructions + blank
      process.stdout.write(`\x1b[${totalLines}A\x1b[J`);
      drawOptions();
    };

    const drawOptions = () => {
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
      process.stdout.write(`\n  ${DIM}↑/↓ move  ·  space toggle  ·  enter confirm${NC}\n`);
    };

    // Initial draw
    drawOptions();

    const stdin = process.stdin;
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf-8");

    const onData = (data: string) => {
      // Enter → confirm
      if (data === "\r" || data === "\n") {
        stdin.setRawMode(false);
        stdin.removeListener("data", onData);
        // Don't pause stdin — readline still needs it
        console.log(""); // blank line after selection
        resolve(options);
        return;
      }

      // Ctrl+C → exit
      if (data === "\x03") {
        stdin.setRawMode(false);
        stdin.removeListener("data", onData);
        process.exit(0);
      }

      // Space → toggle
      if (data === " ") {
        options[cursor]!.selected = !options[cursor]!.selected;
        render();
        return;
      }

      // Arrow keys (escape sequences)
      if (data === "\x1b[A" || data === "k") {
        // Up
        cursor = (cursor - 1 + options.length) % options.length;
        render();
        return;
      }
      if (data === "\x1b[B" || data === "j") {
        // Down
        cursor = (cursor + 1) % options.length;
        render();
        return;
      }

      // 'a' → select all
      if (data === "a") {
        const allSelected = options.every((o) => o.selected);
        for (const opt of options) opt.selected = !allSelected;
        render();
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
// Encryption helpers (AES-256-GCM with PBKDF2)
// ---------------------------------------------------------------------------

async function deriveKey(deviceToken: string, salt: Uint8Array): Promise<CryptoKey> {
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(deviceToken),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: salt as unknown as ArrayBuffer, iterations: 600_000, hash: "SHA-256" },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt"],
  );
}

async function encryptKeys(
  keys: Record<string, string>,
  deviceToken: string,
  salt: Uint8Array,
): Promise<string> {
  const key = await deriveKey(deviceToken, salt);
  const iv = new Uint8Array(randomBytes(12));
  const plaintext = new TextEncoder().encode(JSON.stringify(keys));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    plaintext,
  );
  // Pack as: iv (12 bytes) + ciphertext
  const packed = Buffer.concat([Buffer.from(iv), Buffer.from(ciphertext)]);
  return packed.toString("base64");
}

// ---------------------------------------------------------------------------
// Launchd plist generation
// ---------------------------------------------------------------------------

function generatePlist(bunPath: string, indexPath: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>sh.kent.daemon</string>
  <key>ProgramArguments</key>
  <array>
    <string>${bunPath}</string>
    <string>${indexPath}</string>
    <string>daemon</string>
    <string>start</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${KENT_DIR}/daemon.log</string>
  <key>StandardErrorPath</key>
  <string>${KENT_DIR}/daemon.err</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>/usr/local/bin:/usr/bin:/bin:/opt/homebrew/bin:${homedir()}/.bun/bin</string>
  </dict>
</dict>
</plist>`;
}

// ---------------------------------------------------------------------------
// Built-in workflow templates
// ---------------------------------------------------------------------------

const BUILTIN_WORKFLOWS: Record<string, object> = {
  "daily-brief.yaml": {
    name: "daily-brief",
    prompt: "Generate my daily briefing. Summarize messages, emails, meetings, and GitHub activity from the last 24 hours. Prioritize action items and blockers.",
    schedule: "0 8 * * *",
    runner: "cloud",
    output: "telegram",
  },
  "weekly-review.yaml": {
    name: "weekly-review",
    prompt: "Generate a weekly review. Summarize all activity across every source for the past 7 days. Group by project/topic. Highlight what shipped, what's pending, and what needs follow-up.",
    schedule: "0 17 * * 5",
    runner: "cloud",
    output: "telegram",
  },
  "pr-summary.yaml": {
    name: "pr-summary",
    prompt: "Summarize my open pull requests. For each PR, show: title, repo, review status, and any unresolved comments. Flag PRs older than 3 days.",
    trigger: "github",
    runner: "local",
    output: "stdout",
  },
  "meeting-followup.yaml": {
    name: "meeting-followup",
    prompt: "Based on the latest Granola meeting notes, extract action items assigned to me and draft follow-up messages for each participant.",
    trigger: "granola",
    runner: "cloud",
    output: "telegram",
  },
};

function installWorkflowTemplates(): number {
  const workflowDir = join(KENT_DIR, "workflows");
  if (!existsSync(workflowDir)) {
    mkdirSync(workflowDir, { recursive: true });
  }

  let installed = 0;
  for (const [filename, workflow] of Object.entries(BUILTIN_WORKFLOWS)) {
    const dest = join(workflowDir, filename);
    if (!existsSync(dest)) {
      // Write as YAML-like format (simple key: value since we avoid adding a yaml dep)
      const lines: string[] = [];
      for (const [k, v] of Object.entries(workflow)) {
        lines.push(`${k}: ${JSON.stringify(v)}`);
      }
      writeFileSync(dest, lines.join("\n") + "\n", "utf-8");
      installed++;
    }
  }
  return installed;
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
    label: "Gmail",
    check: async () => {
      const hasGws = await commandExists("gws");
      if (!hasGws) return { ok: false, message: "gws CLI not found. Fix: go install github.com/nicholasgasior/gws@latest && gws auth login" };
      return { ok: true, message: "gws CLI found" };
    },
    collectCreds: async () => {
      info("Gmail uses the gws CLI for OAuth. Make sure you've run: gws auth login");
      const ready = await confirm("Have you authenticated with gws?");
      if (!ready) {
        warn("Run 'gws auth login' before using Gmail source.");
      }
      return {};
    },
  },
  {
    key: "github",
    label: "GitHub",
    check: async () => {
      const hasGh = await commandExists("gh");
      if (!hasGh) return { ok: false, message: "gh CLI not found. Fix: brew install gh && gh auth login" };
      // Check if authenticated
      try {
        const proc = Bun.spawn(["gh", "auth", "status"], { stdout: "pipe", stderr: "pipe" });
        const code = await proc.exited;
        if (code === 0) return { ok: true, message: "gh CLI authenticated" };
        return { ok: false, message: "gh CLI found but not authenticated. Fix: gh auth login" };
      } catch {
        return { ok: false, message: "gh CLI found but auth check failed. Fix: gh auth login" };
      }
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

  const config: Config = { ...DEFAULT_CONFIG };

  // ------------------------------------------------------------------
  // Step 1: Convex URL
  // ------------------------------------------------------------------
  step(1, "Convex Backend");
  info("Kent stores synced data in Convex. You need a deployment URL.");
  info(`${DIM}Get one at https://dashboard.convex.dev — create a project, copy the URL.${NC}`);
  console.log("");

  const envConvexUrl = process.env["CONVEX_URL"] || "";
  const convexDefault = envConvexUrl || "";
  const convexUrl = await ask("CONVEX_URL", convexDefault);

  if (!convexUrl || !convexUrl.includes("convex")) {
    error("Invalid Convex URL. Expected something like: https://your-project-123.convex.cloud");
    error("Set CONVEX_URL env var or re-run kent init.");
    rl.close();
    process.exit(1);
  }
  config.core.convex_url = convexUrl;
  success("Convex URL saved");

  // ------------------------------------------------------------------
  // Step 2: Device token
  // ------------------------------------------------------------------
  step(2, "Device Token");
  const deviceToken = randomBytes(32).toString("base64url");
  config.core.device_token = deviceToken;
  success(`Generated device token: ${deviceToken.slice(0, 12)}...`);

  // ------------------------------------------------------------------
  // Step 3: Encryption salt
  // ------------------------------------------------------------------
  step(3, "Encryption Salt");
  ensureKentDir();
  const saltPath = join(KENT_DIR, "salt");
  const salt = new Uint8Array(randomBytes(16));
  writeFileSync(saltPath, Buffer.from(salt));
  success("Salt saved to ~/.kent/salt");

  // ------------------------------------------------------------------
  // Step 4: Source selection (interactive multi-select)
  // ------------------------------------------------------------------
  step(4, "Sources");
  info("Select which sources to enable. Kent will sync data from these.\n");

  // Check prerequisites for each source first
  const sourceChecks = await Promise.all(
    SOURCES.map(async (s) => {
      const result = await s.check();
      return { source: s, check: result };
    }),
  );

  // Build multi-select options with status indicators
  const selectOptions: SelectOption[] = sourceChecks.map(({ source, check }) => ({
    label: source.label,
    key: source.key,
    selected: check.ok && source.key !== "signal", // default: on if available (except Signal)
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
    } else {
      config.sources[sourceInfo.key] = false;
    }
  }

  const enabledCount = enabledSources.length;
  success(`${enabledCount} source(s) enabled`);

  // ------------------------------------------------------------------
  // Step 5: Channels (Telegram)
  // ------------------------------------------------------------------
  step(5, "Channels");
  const enableTelegram = await confirm("Enable Telegram bot channel?", false);
  if (enableTelegram) {
    info("Get a bot token from @BotFather on Telegram:");
    info(`${DIM}1. Open Telegram → search @BotFather → /newbot${NC}`);
    info(`${DIM}2. Follow prompts → copy the bot token${NC}\n`);
    const botToken = await ask("Telegram bot token", process.env.TELEGRAM_BOT_TOKEN || "");
    if (botToken) {
      config.channels.telegram.enabled = true;
      config.channels.telegram.bot_token = botToken;
      success("Telegram bot token saved");

      info("");
      info("Kent will auto-detect your Telegram user ID when you first message the bot.");
      info("After starting the bot, send it any message and it will whitelist you.");
      info(`${DIM}To add your ID manually later: ~/.kent/config.json → channels.telegram.allowed_user_ids${NC}`);
      config.channels.telegram.allowed_user_ids = []; // empty = auto-detect first user
    } else {
      warn("No token provided. Enable later with: kent channel start telegram");
    }
  }

  // ------------------------------------------------------------------
  // Step 6: Collect credentials
  // ------------------------------------------------------------------
  step(6, "Credentials");
  const collectedKeys: Record<string, string> = {};

  for (const source of enabledSources) {
    if (source.collectCreds) {
      const creds = await source.collectCreds();
      Object.assign(collectedKeys, creds);
    }
  }

  // Ask for AI provider keys
  info("\nKent needs an AI provider key to run the agent.\n");

  const anthropicKey = await ask("Anthropic API key (sk-ant-...)", "");
  if (anthropicKey) {
    collectedKeys["anthropic"] = anthropicKey;
    config.keys.anthropic = "[encrypted]";
  }

  const openaiKey = await ask("OpenAI API key (sk-..., optional)", "");
  if (openaiKey) {
    collectedKeys["openai"] = openaiKey;
    config.keys.openai = "[encrypted]";
  }

  // ------------------------------------------------------------------
  // Step 6: Encrypt keys and push to Convex
  // ------------------------------------------------------------------
  step(7, "Encrypt & Store Keys");

  if (Object.keys(collectedKeys).length > 0) {
    try {
      const encrypted = await encryptKeys(collectedKeys, deviceToken, salt);

      // Register device with Convex and store encrypted keys
      const registerUrl = `${convexUrl.replace(/\/$/, "")}/api/mutation`;
      const response = await fetch(registerUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          path: "auth:registerDevice",
          args: {
            deviceToken,
            encryptedKeys: encrypted,
          },
        }),
      });

      if (response.ok) {
        success("Keys encrypted (AES-256-GCM) and stored in Convex");
      } else {
        warn("Could not push to Convex. Keys saved locally in encrypted form.");
        // Save encrypted blob locally as fallback
        writeFileSync(join(KENT_DIR, "encrypted_keys"), encrypted, "utf-8");
      }
    } catch (e) {
      warn(`Convex push failed: ${e}. Keys saved locally.`);
      const encrypted = await encryptKeys(collectedKeys, deviceToken, salt);
      writeFileSync(join(KENT_DIR, "encrypted_keys"), encrypted, "utf-8");
    }
  } else {
    info("No keys to encrypt. You can add them later with kent init.");
  }

  // ------------------------------------------------------------------
  // Step 7: Save config
  // ------------------------------------------------------------------
  step(8, "Save Config");
  saveConfig(config);
  success(`Config saved to ${CONFIG_PATH}`);

  // ------------------------------------------------------------------
  // Step 8: Install workflow templates
  // ------------------------------------------------------------------
  step(9, "Workflow Templates");
  const workflowCount = installWorkflowTemplates();
  success(`${workflowCount} workflow template(s) installed to ~/.kent/workflows/`);

  // ------------------------------------------------------------------
  // Step 9: Install launchd daemon
  // ------------------------------------------------------------------
  step(10, "Daemon (launchd)");

  try {
    const bunProc = Bun.spawn(["which", "bun"], { stdout: "pipe", stderr: "pipe" });
    const bunPath = (await new Response(bunProc.stdout).text()).trim();
    const cliIndex = join(import.meta.dir, "..", "index.ts");

    const plist = generatePlist(bunPath, cliIndex);
    const plistDir = join(homedir(), "Library", "LaunchAgents");
    if (!existsSync(plistDir)) {
      mkdirSync(plistDir, { recursive: true });
    }
    writeFileSync(PLIST_PATH, plist, "utf-8");
    success(`Plist written to ${PLIST_PATH}`);

    // Load the daemon
    try {
      const loadProc = Bun.spawn(["launchctl", "load", PLIST_PATH], {
        stdout: "pipe",
        stderr: "pipe",
      });
      const loadCode = await loadProc.exited;
      if (loadCode === 0) {
        success("Daemon loaded and running");
      } else {
        warn("Could not load daemon. Start manually: kent daemon start");
      }
    } catch {
      warn("Could not load daemon. Start manually: kent daemon start");
    }
  } catch (e) {
    warn(`Daemon setup failed: ${e}`);
    info("Start manually: kent daemon start");
  }

  // ------------------------------------------------------------------
  // Step 10: First sync
  // ------------------------------------------------------------------
  step(11, "First Sync");
  info("Running initial sync...\n");

  try {
    const syncProc = Bun.spawn(["kent", "sync"], {
      stdout: "inherit",
      stderr: "inherit",
    });
    const syncCode = await syncProc.exited;
    if (syncCode === 0) {
      success("Initial sync complete");
    } else {
      warn("Sync exited with errors. Run 'kent sync' to retry.");
    }
  } catch {
    // kent might not be in PATH yet during fresh install
    warn("Could not run kent sync. Run it manually after install.");
  }

  // ------------------------------------------------------------------
  // Done
  // ------------------------------------------------------------------
  rl.close();

  console.log(`
${GREEN}${BOLD}  Setup complete!${NC}

  Your daemon is running and syncing data every ${config.daemon.sync_interval_minutes} minutes.

  ${BOLD}Try:${NC}
    kent                              ${DIM}# interactive REPL${NC}
    kent run "what's on my plate?"    ${DIM}# one-shot question${NC}
    kent workflow run daily-brief     ${DIM}# run a workflow${NC}
    kent daemon status                ${DIM}# check daemon${NC}

  ${DIM}Config: ~/.kent/config.json${NC}
  ${DIM}Workflows: ~/.kent/workflows/${NC}
  ${DIM}Logs: ~/.kent/daemon.log${NC}
`);
}
