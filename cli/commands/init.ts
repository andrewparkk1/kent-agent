import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { createInterface } from "node:readline";
import {
  type Config,
  KENT_DIR,
  CONFIG_PATH,
  DEFAULT_CONFIG,
  CONVEX_URL,
  KENT_TELEGRAM_BOT,
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

    // Total lines we draw: options.length + 1 (blank) + 1 (instructions)
    const totalLines = options.length + 2;

    const draw = () => {
      // If we've drawn before, move cursor up and clear everything we drew
      if (drawn) {
        process.stdout.write(`\x1b[${totalLines}F`); // move to start of our block
        process.stdout.write(`\x1b[0J`); // clear from cursor to end of screen
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

    // Initial draw
    draw();

    const stdin = process.stdin;
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf-8");

    const onData = (data: string) => {
      // Enter → confirm
      if (data === "\r" || data === "\n") {
        stdin.setRawMode(false);
        stdin.removeListener("data", onData);
        process.stdout.write("\n\n");
        resolve(options);
        return;
      }

      // Ctrl+C → exit
      if (data === "\x03") {
        stdin.setRawMode(false);
        stdin.removeListener("data", onData);
        process.stdout.write("\n");
        process.exit(0);
      }

      // Space → toggle
      if (data === " ") {
        options[cursor]!.selected = !options[cursor]!.selected;
        draw();
        return;
      }

      // Arrow keys (escape sequences)
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

      // 'a' → select all / deselect all
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
    label: "Gmail & Calendar",
    check: async () => {
      const hasGws = await commandExists("gws");
      if (!hasGws) return { ok: false, message: "gws CLI not installed" };
      // Check if fully authenticated (has valid token)
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

      // Check if already authenticated with valid token
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

      // Check if OAuth client is set up (credentials.json exists)
      const hasCredentials = existsSync(
        join(homedir(), "Library/Application Support/gws/client_secret.json")
      ) || existsSync(
        join(homedir(), "Library/Application Support/gws/credentials.enc")
      );

      if (!hasCredentials) {
        // Need to set up GCP project + OAuth client first
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

      // Credentials exist but not logged in — just need to auth
      info("Opening Gmail OAuth in your browser...");
      const authProc = Bun.spawn(["gws", "auth", "login", "-s", "gmail,calendar"], {
        stdout: "inherit", stderr: "inherit", stdin: "inherit",
      });
      const code = await authProc.exited;
      if (code === 0) {
        success("Gmail: authenticated");
      } else {
        warn("Gmail auth failed. Run 'gws auth login -s gmail,calendar' later.");
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
      // Check if authenticated
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

      // Check if already authenticated
      try {
        const checkProc = Bun.spawn(["gh", "auth", "status"], { stdout: "pipe", stderr: "pipe" });
        if ((await checkProc.exited) === 0) {
          success("GitHub: already authenticated");
          return {};
        }
      } catch { }

      // Not authenticated — run auth automatically
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
// Telegram deep link polling
// ---------------------------------------------------------------------------

async function pollTelegramLink(
  deviceToken: string,
  timeoutMs = 60_000,
  intervalMs = 2_000,
): Promise<{ linked: boolean; userId?: number; username?: string }> {
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${CONVEX_URL}/api/query`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          path: "telegram:checkLink",
          args: { deviceToken },
        }),
      });

      if (res.ok) {
        const data = (await res.json()) as {
          value?: { linked: boolean; userId?: number; username?: string };
        };
        if (data.value?.linked) {
          return {
            linked: true,
            userId: data.value.userId,
            username: data.value.username,
          };
        }
      }
    } catch {
      // Network error — keep polling
    }

    await new Promise((r) => setTimeout(r, intervalMs));
  }

  return { linked: false };
}

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
  const TOTAL_STEPS = 5;

  // ------------------------------------------------------------------
  // Step 1: Device Token
  // ------------------------------------------------------------------
  step(1, TOTAL_STEPS, "Device Token");
  const deviceToken = randomBytes(32).toString("base64url");
  config.core.device_token = deviceToken;
  success(`Generated device token: ${deviceToken.slice(0, 12)}...`);

  // Generate encryption salt
  ensureKentDir();
  const saltPath = join(KENT_DIR, "salt");
  const salt = new Uint8Array(randomBytes(16));
  writeFileSync(saltPath, Buffer.from(salt));

  // Register device with Convex
  try {
    const registerUrl = `${CONVEX_URL}/api/mutation`;
    const response = await fetch(registerUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        path: "auth:registerDevice",
        args: {
          deviceToken,
          encryptedKeys: "",
          encryptionSalt: Buffer.from(salt).toString("base64"),
        },
      }),
    });
    if (!response.ok) {
      warn("Could not register device with Kent servers. Will retry on first sync.");
    }
  } catch {
    warn("Could not reach Kent servers. Will retry on first sync.");
  }

  // ------------------------------------------------------------------
  // Step 2: AI Provider
  // ------------------------------------------------------------------
  step(2, TOTAL_STEPS, "AI Provider");
  info("Kent needs an API key to run the agent.\n");

  const collectedKeys: Record<string, string> = {};

  const anthropicKey = await ask("Anthropic API key (sk-ant-...)", "");
  if (anthropicKey) {
    collectedKeys["anthropic"] = anthropicKey;
    config.keys.anthropic = "[encrypted]";
    success("Anthropic key saved");
  } else {
    warn("No Anthropic key provided. Add one later with: kent init");
  }

  console.log("");
  const openaiKey = await ask("OpenAI API key (optional, press enter to skip)", "");
  if (openaiKey) {
    collectedKeys["openai"] = openaiKey;
    config.keys.openai = "[encrypted]";
    success("OpenAI key saved");
  } else {
    warn("No OpenAI key provided. Add one later with: kent init");
  }

  // Encrypt and push keys
  if (Object.keys(collectedKeys).length > 0) {
    try {
      const encrypted = await encryptKeys(collectedKeys, deviceToken, salt);
      const registerUrl = `${CONVEX_URL}/api/mutation`;
      const response = await fetch(registerUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          path: "auth:registerDevice",
          args: {
            deviceToken,
            encryptedKeys: encrypted,
            encryptionSalt: Buffer.from(salt).toString("base64"),
          },
        }),
      });
      if (!response.ok) {
        warn("Could not push encrypted keys to Kent servers. Saved locally.");
        writeFileSync(join(KENT_DIR, "encrypted_keys"), encrypted, "utf-8");
      }
    } catch (e) {
      warn(`Key encryption/upload failed: ${e}. Saved locally.`);
      const encrypted = await encryptKeys(collectedKeys, deviceToken, salt);
      writeFileSync(join(KENT_DIR, "encrypted_keys"), encrypted, "utf-8");
    }
  }

  // ------------------------------------------------------------------
  // Step 3: Sources (interactive multi-select)
  // ------------------------------------------------------------------
  step(3, TOTAL_STEPS, "Sources");
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
    selected: check.ok, // default: on if available
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

  // Collect any source-specific credentials
  for (const source of enabledSources) {
    if (source.collectCreds) {
      await source.collectCreds();
    }
  }

  // ------------------------------------------------------------------
  // Step 4: Link Telegram
  // ------------------------------------------------------------------
  step(4, TOTAL_STEPS, "Link Telegram");
  info("Chat with Kent and receive notifications on your phone.\n");

  const linkTelegram = await confirm("Link Telegram now?", true);

  if (linkTelegram) {
    const deepLink = `https://t.me/${KENT_TELEGRAM_BOT}?start=${deviceToken}`;
    info(`${CYAN}→ Opening Telegram...${NC}`);

    try {
      Bun.spawn(["open", deepLink], { stdout: "pipe", stderr: "pipe" });
    } catch {
      info(`Open this link manually: ${deepLink}`);
    }

    process.stdout.write(`  Waiting for you to tap "Start"... `);

    const linkResult = await pollTelegramLink(deviceToken);

    if (linkResult.linked) {
      config.telegram.linked = true;
      config.telegram.user_id = linkResult.userId ?? null;
      config.telegram.username = linkResult.username ?? null;
      const usernameDisplay = linkResult.username ? ` (@${linkResult.username})` : "";
      console.log(`${GREEN}✓ Linked!${usernameDisplay}${NC}`);
    } else {
      console.log("");
      warn("Timed out waiting for Telegram link. You can link later with: kent init");
    }
  } else {
    warn("Skipped — link later with: kent init");
  }

  // ------------------------------------------------------------------
  // Step 5: Start Daemon
  // ------------------------------------------------------------------
  step(5, TOTAL_STEPS, "Start Daemon");

  // Save config first
  saveConfig(config);
  success(`Config saved to ${CONFIG_PATH}`);

  // Install workflow templates
  const workflowCount = installWorkflowTemplates();
  if (workflowCount > 0) {
    success(`${workflowCount} workflow template(s) installed`);
  }

  // Install and start launchd daemon
  try {
    await daemonStart();
    success("Daemon started");
  } catch (e) {
    warn(`Daemon setup failed: ${e}`);
    info("Start manually: kent daemon start");
  }

  // Run initial sync
  info("Running initial sync...");
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

  ${BOLD}Try:${NC}
    kent                    ${DIM}# interactive REPL${NC}
    kent sync               ${DIM}# manual sync${NC}
    kent workflow list      ${DIM}# see workflows${NC}

  ${DIM}Config: ~/.kent/config.json${NC}
  ${DIM}Logs: ~/.kent/daemon.log${NC}
`);
}
