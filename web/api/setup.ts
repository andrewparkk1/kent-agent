/** Setup API endpoints — mirrors the CLI `kent init` wizard for the web UI. */
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import {
  Config,
  CONFIG_PATH,
  KENT_DIR,
  PROMPTS_DIR,
  ensureKentDir,
  loadConfig,
  saveConfig,
} from "../../shared/config.ts";
import {
  detectHardware,
  getLocalModelOptions,
  recommendLocalModel,
} from "../../shared/models.ts";
import { createWorkflow, listWorkflows } from "../../shared/db.ts";
import { DEFAULT_WORKFLOWS } from "../../shared/default-workflows.ts";
import { handleSync } from "./sync.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function commandExists(cmd: string): Promise<boolean> {
  try {
    const proc = Bun.spawn(["which", cmd], { stdout: "pipe", stderr: "pipe" });
    return (await proc.exited) === 0;
  } catch {
    return false;
  }
}

function installPrompts(): { copied: number } {
  const bundledDir = join(dirname(import.meta.path), "..", "..", "agent", "prompts");

  if (!existsSync(bundledDir)) {
    return { copied: 0 };
  }

  mkdirSync(PROMPTS_DIR, { recursive: true });
  mkdirSync(join(PROMPTS_DIR, "skills"), { recursive: true });

  let copied = 0;

  for (const name of readdirSync(bundledDir)) {
    const srcPath = join(bundledDir, name);

    if (name === "skills") {
      const skillsSrc = join(bundledDir, "skills");
      for (const skillName of readdirSync(skillsSrc)) {
        const skillPath = join(skillsSrc, skillName);
        if (statSync(skillPath).isDirectory()) {
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

  return { copied };
}

// ---------------------------------------------------------------------------
// 1. GET /api/setup/status — check if setup is needed
// ---------------------------------------------------------------------------

export function handleSetupStatus() {
  const configExists = existsSync(CONFIG_PATH);
  if (!configExists) {
    return Response.json({ needsSetup: true, reason: "no_config" });
  }
  const config = loadConfig();
  if (!config.core.device_token) {
    return Response.json({ needsSetup: true, reason: "missing_device_token" });
  }
  return Response.json({ needsSetup: false });
}

// ---------------------------------------------------------------------------
// 2. POST /api/setup/init — generate device token, create dir, install prompts
// ---------------------------------------------------------------------------

export function handleSetupInit() {
  ensureKentDir();

  const deviceToken = randomBytes(32).toString("base64url");

  // Persist the device token to config
  const config = loadConfig();
  config.core.device_token = deviceToken;
  saveConfig(config);

  // Install bundled prompts
  const { copied } = installPrompts();

  // Check Full Disk Access
  const imessageDb = join(homedir(), "Library/Messages/chat.db");
  const appleNotesDb = join(homedir(), "Library/Group Containers/group.com.apple.notes/NoteStore.sqlite");
  const hasFullDiskAccess = existsSync(imessageDb) && existsSync(appleNotesDb);

  return Response.json({
    deviceToken,
    promptsInstalled: copied,
    hasFullDiskAccess,
    kentDir: KENT_DIR,
  });
}

// ---------------------------------------------------------------------------
// 3. GET /api/setup/hardware — return hardware info for model recommendations
// ---------------------------------------------------------------------------

export function handleSetupHardware() {
  const hw = detectHardware();
  const recommendation = recommendLocalModel(hw.ramGB);
  const options = getLocalModelOptions(hw.ramGB);

  return Response.json({
    hardware: hw,
    recommendation,
    localModelOptions: options,
  });
}

// ---------------------------------------------------------------------------
// 4. GET /api/setup/check-sources — check prerequisites for all sources
// ---------------------------------------------------------------------------

export async function handleSetupCheckSources() {
  const home = homedir();

  const results: Record<string, { ok: boolean; message: string }> = {};

  // Run all CLI checks in parallel (these spawn subprocesses and are slow)
  const [hasSqlcipher, hasGws, hasGh, hasOsascript, hasMdfind] = await Promise.all([
    commandExists("sqlcipher"),
    commandExists("gws"),
    commandExists("gh"),
    commandExists("osascript"),
    commandExists("mdfind"),
  ]);

  // Run auth checks in parallel too (only if CLIs exist)
  const [gwsAuth, ghAuth] = await Promise.all([
    hasGws
      ? (async () => {
          try {
            const proc = Bun.spawn(["gws", "auth", "status", "--format", "json"], { stdout: "pipe", stderr: "pipe" });
            const code = await proc.exited;
            if (code === 0) {
              const output = await new Response(proc.stdout).text();
              const status = JSON.parse(output);
              return status.token_valid ? `authenticated as ${status.user}` : "gws found (needs auth)";
            }
            return "gws found (needs setup)";
          } catch {
            return "gws found (needs setup)";
          }
        })()
      : Promise.resolve(null),
    hasGh
      ? (async () => {
          try {
            const proc = Bun.spawn(["gh", "auth", "status"], { stdout: "pipe", stderr: "pipe" });
            const code = await proc.exited;
            if (code === 0) {
              const output = await new Response(proc.stderr).text();
              const match = output.match(/Logged in to .+ as (.+)/);
              return `authenticated as ${match?.[1] ?? "user"}`;
            }
            return "gh found (needs auth)";
          } catch {
            return "gh found (needs auth)";
          }
        })()
      : Promise.resolve(null),
  ]);

  // Now assign results — all file checks are sync and instant

  // iMessage
  const imessageDb = join(home, "Library/Messages/chat.db");
  results.imessage = existsSync(imessageDb)
    ? { ok: true, message: "chat.db found" }
    : { ok: false, message: "chat.db not found. Grant Full Disk Access to your terminal in System Settings > Privacy & Security." };

  // Signal
  const signalDb = join(home, "Library/Application Support/Signal/sql/db.sqlite");
  if (!existsSync(signalDb)) {
    results.signal = { ok: false, message: "Signal desktop not installed or no database found." };
  } else {
    results.signal = hasSqlcipher
      ? { ok: true, message: "Signal DB + sqlcipher found" }
      : { ok: false, message: "Requires sqlcipher. Fix: brew install sqlcipher" };
  }

  // Granola
  const granolaDir = join(home, "Library/Application Support/Granola");
  results.granola = existsSync(granolaDir)
    ? { ok: true, message: "Granola directory found" }
    : { ok: false, message: "Granola not installed. Download from https://granola.ai" };

  // Gmail / Google
  results.gmail = hasGws
    ? { ok: true, message: gwsAuth! }
    : { ok: false, message: "gws CLI not installed" };

  // GitHub
  results.github = hasGh
    ? { ok: true, message: ghAuth! }
    : { ok: false, message: "gh CLI not installed" };

  // Chrome
  const chromeDb = join(home, "Library/Application Support/Google/Chrome/Default/History");
  results.chrome = existsSync(chromeDb)
    ? { ok: true, message: "Chrome history DB found" }
    : { ok: false, message: "Chrome history not found. Is Chrome installed?" };

  // Apple Notes
  const appleNotesDb = join(home, "Library/Group Containers/group.com.apple.notes/NoteStore.sqlite");
  results.apple_notes = existsSync(appleNotesDb)
    ? { ok: true, message: "NoteStore.sqlite found" }
    : { ok: false, message: "Apple Notes DB not found. Grant Full Disk Access to your terminal in System Settings > Privacy & Security." };

  // AI Coding
  const hasClaudeCode = existsSync(join(home, ".claude/projects"));
  const hasCodex = existsSync(join(home, ".codex/history.jsonl"));
  if (hasClaudeCode && hasCodex) {
    results.ai_coding = { ok: true, message: "Claude Code + Codex found" };
  } else if (hasClaudeCode) {
    results.ai_coding = { ok: true, message: "Claude Code found" };
  } else if (hasCodex) {
    results.ai_coding = { ok: true, message: "Codex found" };
  } else {
    results.ai_coding = { ok: false, message: "No Claude Code or Codex data found" };
  }

  // Safari
  const safariDb = join(home, "Library/Safari/History.db");
  results.safari = existsSync(safariDb)
    ? { ok: true, message: "Safari history DB found" }
    : { ok: false, message: "Safari history not found. Is Safari installed?" };

  // Apple Reminders
  results.apple_reminders = hasOsascript
    ? { ok: true, message: "Reminders.app available" }
    : { ok: false, message: "osascript not found (requires macOS)" };

  // Contacts
  const contactsDb = join(home, "Library/Application Support/AddressBook/AddressBook-v22.abcddb");
  const contactsSources = join(home, "Library/Application Support/AddressBook/Sources");
  results.contacts = existsSync(contactsDb) || existsSync(contactsSources)
    ? { ok: true, message: "AddressBook found" }
    : { ok: false, message: "AddressBook not found. Grant Full Disk Access." };

  // Obsidian
  const obsidianConfig = join(home, "Library/Application Support/obsidian/obsidian.json");
  const hasObsidianEnv = !!process.env.OBSIDIAN_VAULT_PATH;
  results.obsidian = existsSync(obsidianConfig) || hasObsidianEnv
    ? { ok: true, message: "Obsidian vault found" }
    : { ok: false, message: "Obsidian not installed" };

  // WhatsApp
  const whatsappDb = join(home, "Library/Group Containers/group.net.whatsapp.WhatsApp.shared/ChatStorage.sqlite");
  results.whatsapp = existsSync(whatsappDb)
    ? { ok: true, message: "WhatsApp Desktop DB found" }
    : { ok: false, message: "WhatsApp Desktop not installed" };

  // Slack (needs API token)
  const config = loadConfig();
  const hasSlackToken = !!(process.env.SLACK_TOKEN || (config.keys as Record<string, string>).slack);
  results.slack = hasSlackToken
    ? { ok: true, message: "Slack token configured" }
    : { ok: false, message: "Needs API token (set keys.slack in config)" };

  // Notion (needs API token)
  const hasNotionToken = !!(process.env.NOTION_TOKEN || (config.keys as Record<string, string>).notion);
  results.notion = hasNotionToken
    ? { ok: true, message: "Notion token configured" }
    : { ok: false, message: "Needs API token (set keys.notion in config)" };

  // Spotify (needs OAuth credentials)
  const keys = config.keys as Record<string, string>;
  const hasSpotify = !!(
    (process.env.SPOTIFY_CLIENT_ID || keys.spotify_client_id) &&
    (process.env.SPOTIFY_REFRESH_TOKEN || keys.spotify_refresh_token)
  );
  results.spotify = hasSpotify
    ? { ok: true, message: "Spotify credentials configured" }
    : { ok: false, message: "Needs OAuth credentials (set keys.spotify_* in config)" };

  // Apple Music (needs osascript)
  results.apple_music = hasOsascript
    ? { ok: true, message: "Music.app available" }
    : { ok: false, message: "osascript not found (requires macOS)" };

  // Apple Health
  const healthDb = join(home, "Library/Health/healthdb.sqlite");
  results.apple_health = existsSync(healthDb)
    ? { ok: true, message: "HealthKit database found" }
    : { ok: false, message: "Health data not synced. Enable Health in iCloud settings." };

  // Screen Time
  const knowledgeDb = join(home, "Library/Application Support/Knowledge/knowledgeC.db");
  results.screen_time = existsSync(knowledgeDb)
    ? { ok: true, message: "Knowledge store found" }
    : { ok: false, message: "Screen Time data not found. Enable Screen Time in System Settings." };

  // Recent Files (needs mdfind / Spotlight)
  results.recent_files = hasMdfind
    ? { ok: true, message: "Spotlight indexing available" }
    : { ok: false, message: "mdfind not found (requires macOS)" };

  // Apple Calendar (needs osascript)
  results.apple_calendar = hasOsascript
    ? { ok: true, message: "Calendar.app available" }
    : { ok: false, message: "osascript not found (requires macOS)" };

  // Outlook
  const outlookDb = join(home, "Library/Group Containers/UBF8T346G9.Office/Outlook/Outlook 15 Profiles/Main Profile/Data/Outlook.sqlite");
  const hasOutlookToken = !!(process.env.OUTLOOK_TOKEN || (config.keys as Record<string, string>).outlook);
  if (existsSync(outlookDb)) {
    results.outlook = { ok: true, message: "Outlook for Mac DB found" };
  } else if (hasOutlookToken) {
    results.outlook = { ok: true, message: "Microsoft Graph token configured" };
  } else {
    results.outlook = { ok: false, message: "Outlook not installed. Set keys.outlook for Graph API." };
  }

  // Convert to array format expected by frontend: { key, available, connected }
  const sourcesArray = Object.entries(results).map(([key, val]) => ({
    key,
    available: val.ok,
    connected: val.ok && !val.message.includes("needs auth") && !val.message.includes("needs setup"),
    message: val.message,
  }));

  return Response.json({ sources: sourcesArray });
}

// ---------------------------------------------------------------------------
// 5. GET /api/setup/ollama/status — check if Ollama is installed + list models
// ---------------------------------------------------------------------------

export async function handleSetupOllamaStatus() {
  const installed = await commandExists("ollama");
  if (!installed) {
    return Response.json({ installed: false, running: false, models: [] });
  }

  // Check if Ollama server is running by listing models
  try {
    const proc = Bun.spawn(["ollama", "list"], { stdout: "pipe", stderr: "pipe" });
    const code = await proc.exited;
    if (code === 0) {
      const output = await new Response(proc.stdout).text();
      const lines = output.trim().split("\n").slice(1); // skip header
      const models = lines
        .filter((l) => l.trim())
        .map((line) => {
          const parts = line.split(/\s+/);
          return { name: parts[0], size: parts[2] ?? "", modified: parts[3] ?? "" };
        });
      return Response.json({ installed: true, running: true, models });
    }
  } catch {}

  return Response.json({ installed: true, running: false, models: [] });
}

// ---------------------------------------------------------------------------
// 6. POST /api/setup/ollama/install — brew install ollama
// ---------------------------------------------------------------------------

export async function handleSetupOllamaInstall() {
  try {
    const proc = Bun.spawn(["brew", "install", "ollama"], { stdout: "pipe", stderr: "pipe" });
    const code = await proc.exited;
    const stderr = await new Response(proc.stderr).text();
    if (code === 0) {
      return Response.json({ ok: true, message: "Ollama installed successfully" });
    }
    return Response.json({ ok: false, error: stderr || "brew install ollama failed" }, { status: 500 });
  } catch (e) {
    return Response.json({ ok: false, error: String(e) }, { status: 500 });
  }
}

// ---------------------------------------------------------------------------
// 7. POST /api/setup/ollama/pull — ollama pull <model>
// ---------------------------------------------------------------------------

export async function handleSetupOllamaPull(req: Request) {
  const body = await req.json() as { model?: string };
  const model = body.model;
  if (!model) {
    return Response.json({ error: "model is required" }, { status: 400 });
  }
  if (!/^[a-zA-Z0-9._:/-]+$/.test(model)) {
    return Response.json({ error: "invalid model name" }, { status: 400 });
  }

  try {
    const proc = Bun.spawn(["ollama", "pull", model], { stdout: "pipe", stderr: "pipe" });
    const code = await proc.exited;
    const stdout = await new Response(proc.stdout).text();
    const stderr = await new Response(proc.stderr).text();
    if (code === 0) {
      return Response.json({ ok: true, message: `Pulled ${model}`, output: stdout.trim() });
    }
    return Response.json({ ok: false, error: stderr || `Failed to pull ${model}` }, { status: 500 });
  } catch (e) {
    return Response.json({ ok: false, error: String(e) }, { status: 500 });
  }
}

// ---------------------------------------------------------------------------
// 8. POST /api/setup/oauth/gmail — install gws if needed, run OAuth
// ---------------------------------------------------------------------------

export async function handleSetupOAuthGmail() {
  const hasGws = await commandExists("gws");
  if (!hasGws) {
    const installProc = Bun.spawn(["brew", "install", "gws"], { stdout: "pipe", stderr: "pipe" });
    const code = await installProc.exited;
    if (code !== 0) {
      const stderr = await new Response(installProc.stderr).text();
      return Response.json({ ok: false, error: `Could not install gws: ${stderr}` }, { status: 500 });
    }
  }

  // Check if already authenticated
  try {
    const statusProc = Bun.spawn(["gws", "auth", "status", "--format", "json"], { stdout: "pipe", stderr: "pipe" });
    const code = await statusProc.exited;
    if (code === 0) {
      const output = await new Response(statusProc.stdout).text();
      const status = JSON.parse(output);
      if (status.token_valid) {
        return Response.json({ ok: true, authenticated: true, user: status.user });
      }
    }
  } catch {}

  // Check if credentials exist
  const hasCredentials =
    existsSync(join(homedir(), "Library/Application Support/gws/client_secret.json")) ||
    existsSync(join(homedir(), "Library/Application Support/gws/credentials.enc"));

  if (!hasCredentials) {
    // Need full setup (create GCP project + OAuth)
    const setupProc = Bun.spawn(["gws", "auth", "setup", "--login"], {
      stdout: "pipe",
      stderr: "pipe",
      stdin: "inherit",
    });
    const code = await setupProc.exited;
    if (code === 0) {
      return Response.json({ ok: true, authenticated: true, message: "GCP project + OAuth set up and authenticated" });
    }
    return Response.json({ ok: false, error: "Gmail setup incomplete. Run 'gws auth setup --login' manually." }, { status: 500 });
  }

  // Have credentials, just need to authenticate
  const authProc = Bun.spawn(["gws", "auth", "login", "-s", "gmail,calendar,tasks,drive"], {
    stdout: "pipe",
    stderr: "pipe",
    stdin: "inherit",
  });
  const code = await authProc.exited;
  if (code === 0) {
    return Response.json({ ok: true, authenticated: true, message: "Gmail authenticated" });
  }
  return Response.json({ ok: false, error: "Gmail auth failed. Run 'gws auth login -s gmail,calendar,tasks' later." }, { status: 500 });
}

// ---------------------------------------------------------------------------
// 9. POST /api/setup/oauth/github — install gh if needed, run OAuth
// ---------------------------------------------------------------------------

export async function handleSetupOAuthGithub() {
  const hasGh = await commandExists("gh");
  if (!hasGh) {
    const installProc = Bun.spawn(["brew", "install", "gh"], { stdout: "pipe", stderr: "pipe" });
    const code = await installProc.exited;
    if (code !== 0) {
      const stderr = await new Response(installProc.stderr).text();
      return Response.json({ ok: false, error: `Could not install gh: ${stderr}` }, { status: 500 });
    }
  }

  // Check if already authenticated
  try {
    const checkProc = Bun.spawn(["gh", "auth", "status"], { stdout: "pipe", stderr: "pipe" });
    if ((await checkProc.exited) === 0) {
      return Response.json({ ok: true, authenticated: true, message: "GitHub already authenticated" });
    }
  } catch {}

  // Run OAuth
  const authProc = Bun.spawn(["gh", "auth", "login", "--web", "-p", "https"], {
    stdout: "pipe",
    stderr: "pipe",
    stdin: "inherit",
  });
  const code = await authProc.exited;
  if (code === 0) {
    return Response.json({ ok: true, authenticated: true, message: "GitHub authenticated" });
  }
  return Response.json({ ok: false, error: "GitHub auth failed. Run 'gh auth login' later." }, { status: 500 });
}

// ---------------------------------------------------------------------------
// 10. POST /api/setup/save-config — merge and save config from wizard
// ---------------------------------------------------------------------------

export async function handleSetupSaveConfig(req: Request) {
  const body = await req.json() as { config: Partial<Config> };
  if (!body.config) {
    return Response.json({ error: "config is required" }, { status: 400 });
  }

  const existing = loadConfig();
  const incoming = body.config;

  const merged: Config = {
    core: { ...existing.core, ...incoming.core },
    keys: { ...existing.keys, ...incoming.keys },
    sources: { ...existing.sources, ...incoming.sources },
    daemon: { ...existing.daemon, ...incoming.daemon },
    agent: { ...existing.agent, ...incoming.agent },
  };

  saveConfig(merged);
  return Response.json({ ok: true, config: merged });
}

// ---------------------------------------------------------------------------
// 11. POST /api/setup/sync — seed default workflows + trigger initial sync
// ---------------------------------------------------------------------------

export async function handleSetupSync() {
  // Seed default workflows if none exist
  const existing = await listWorkflows();
  let workflowsCreated = 0;
  if (existing.length === 0) {
    for (const wf of DEFAULT_WORKFLOWS) {
      try {
        await createWorkflow(wf);
        workflowsCreated++;
      } catch {
        // Duplicate name — skip
      }
    }
  }

  // Trigger initial sync for all enabled sources
  const config = loadConfig();
  const syncResults: Record<string, { ok: boolean; message: string }> = {};

  const sourceKeys = Object.entries(config.sources)
    .filter(([_, enabled]) => enabled)
    .map(([key]) => key);

  for (const sourceKey of sourceKeys) {
    try {
      const fakeReq = new Request("http://localhost/api/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source: sourceKey }),
      });
      const res = await handleSync(fakeReq);
      const data = await res.json() as { message?: string; error?: string };
      if (res.ok) {
        syncResults[sourceKey] = { ok: true, message: data.message ?? "synced" };
      } else {
        syncResults[sourceKey] = { ok: false, message: data.error ?? "sync failed" };
      }
    } catch (e) {
      syncResults[sourceKey] = { ok: false, message: String(e) };
    }
  }

  return Response.json({ workflowsCreated, syncResults });
}

// ---------------------------------------------------------------------------
// 12. POST /api/setup/start-services — register launchd agents
// ---------------------------------------------------------------------------

export async function handleSetupStartServices() {
  const errors: string[] = [];

  // Start daemon
  try {
    const { daemonStart } = await import("../../cli/commands/daemon.ts");
    await daemonStart();
  } catch (e) {
    errors.push(`Daemon: ${String(e)}`);
  }

  // Install web launchd
  try {
    const { installWebLaunchd } = await import("../../cli/commands/web.ts");
    installWebLaunchd();
  } catch (e) {
    errors.push(`Web: ${String(e)}`);
  }

  if (errors.length > 0) {
    return Response.json({ ok: false, errors }, { status: 500 });
  }

  return Response.json({ ok: true, message: "Daemon and web services registered" });
}
