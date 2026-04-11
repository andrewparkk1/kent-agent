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
// 4. GET /api/setup/check-sources — stream source detection results via SSE
// ---------------------------------------------------------------------------

function sseEvent(key: string, ok: boolean, message: string): string {
  const connected = ok && !message.includes("needs auth") && !message.includes("needs setup");
  return `data: ${JSON.stringify({ key, available: ok, connected, message })}\n\n`;
}

export function handleSetupCheckSources() {
  const home = homedir();
  const config = loadConfig();
  const keys = config.keys as Record<string, string>;
  const enc = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const emit = (key: string, ok: boolean, msg: string) =>
        controller.enqueue(enc.encode(sseEvent(key, ok, msg)));

      // ── Instant file/token checks — emit immediately ──────────────
      const fc = (path: string) => existsSync(path);

      emit("imessage", fc(join(home, "Library/Messages/chat.db")), fc(join(home, "Library/Messages/chat.db")) ? "chat.db found" : "chat.db not found. Grant Full Disk Access.");
      emit("granola", fc(join(home, "Library/Application Support/Granola")), fc(join(home, "Library/Application Support/Granola")) ? "Granola directory found" : "Granola not installed");
      emit("chrome", fc(join(home, "Library/Application Support/Google/Chrome/Default/History")), fc(join(home, "Library/Application Support/Google/Chrome/Default/History")) ? "Chrome history DB found" : "Chrome not found");
      emit("apple_notes", fc(join(home, "Library/Group Containers/group.com.apple.notes/NoteStore.sqlite")), fc(join(home, "Library/Group Containers/group.com.apple.notes/NoteStore.sqlite")) ? "NoteStore.sqlite found" : "Apple Notes DB not found. Grant Full Disk Access.");
      emit("safari", fc(join(home, "Library/Safari/History.db")), fc(join(home, "Library/Safari/History.db")) ? "Safari history DB found" : "Safari not found");
      emit("whatsapp", fc(join(home, "Library/Group Containers/group.net.whatsapp.WhatsApp.shared/ChatStorage.sqlite")), fc(join(home, "Library/Group Containers/group.net.whatsapp.WhatsApp.shared/ChatStorage.sqlite")) ? "WhatsApp Desktop DB found" : "WhatsApp Desktop not installed");
      emit("apple_health", fc(join(home, "Library/Health/healthdb.sqlite")), fc(join(home, "Library/Health/healthdb.sqlite")) ? "HealthKit database found" : "Enable Health in iCloud settings");
      emit("screen_time", fc(join(home, "Library/Application Support/Knowledge/knowledgeC.db")), fc(join(home, "Library/Application Support/Knowledge/knowledgeC.db")) ? "Knowledge store found" : "Enable Screen Time in System Settings");
      emit("contacts", fc(join(home, "Library/Application Support/AddressBook/AddressBook-v22.abcddb")) || fc(join(home, "Library/Application Support/AddressBook/Sources")), fc(join(home, "Library/Application Support/AddressBook/AddressBook-v22.abcddb")) || fc(join(home, "Library/Application Support/AddressBook/Sources")) ? "AddressBook found" : "AddressBook not found. Grant Full Disk Access.");
      emit("obsidian", fc(join(home, "Library/Application Support/obsidian/obsidian.json")) || !!process.env.OBSIDIAN_VAULT_PATH, fc(join(home, "Library/Application Support/obsidian/obsidian.json")) || !!process.env.OBSIDIAN_VAULT_PATH ? "Obsidian vault found" : "Obsidian not installed");

      const hasCC = fc(join(home, ".claude/projects")), hasCx = fc(join(home, ".codex/history.jsonl"));
      emit("ai_coding", hasCC || hasCx, hasCC && hasCx ? "Claude Code + Codex found" : hasCC ? "Claude Code found" : hasCx ? "Codex found" : "No Claude Code or Codex data found");

      emit("slack", !!(process.env.SLACK_TOKEN || keys.slack), process.env.SLACK_TOKEN || keys.slack ? "Slack token configured" : "Needs API token (keys.slack)");
      emit("notion", !!(process.env.NOTION_TOKEN || keys.notion), process.env.NOTION_TOKEN || keys.notion ? "Notion token configured" : "Needs API token (keys.notion)");
      emit("spotify", !!((process.env.SPOTIFY_CLIENT_ID || keys.spotify_client_id) && (process.env.SPOTIFY_REFRESH_TOKEN || keys.spotify_refresh_token)), (process.env.SPOTIFY_CLIENT_ID || keys.spotify_client_id) && (process.env.SPOTIFY_REFRESH_TOKEN || keys.spotify_refresh_token) ? "Spotify configured" : "Needs OAuth credentials (keys.spotify_*)");

      const outlookPath = join(home, "Library/Group Containers/UBF8T346G9.Office/Outlook/Outlook 15 Profiles/Main Profile/Data/Outlook.sqlite");
      emit("outlook", fc(outlookPath) || !!(process.env.OUTLOOK_TOKEN || keys.outlook), fc(outlookPath) ? "Outlook for Mac DB found" : process.env.OUTLOOK_TOKEN || keys.outlook ? "Graph token configured" : "Outlook not installed");

      // ── Slow CLI checks — run in parallel, emit as each resolves ──
      await Promise.all([
        // Signal
        (async () => {
          if (!fc(join(home, "Library/Application Support/Signal/sql/db.sqlite"))) {
            emit("signal", false, "Signal desktop not installed");
            return;
          }
          const has = await commandExists("sqlcipher");
          emit("signal", has, has ? "Signal DB + sqlcipher found" : "Requires sqlcipher. brew install sqlcipher");
        })(),

        // Gmail + gws auth
        (async () => {
          const has = await commandExists("gws");
          if (!has) { emit("gmail", false, "gws CLI not installed"); return; }
          try {
            const proc = Bun.spawn(["gws", "auth", "status", "--format", "json"], { stdout: "pipe", stderr: "pipe" });
            const code = await proc.exited;
            if (code === 0) {
              const out = await new Response(proc.stdout).text();
              const s = JSON.parse(out);
              emit("gmail", true, s.token_valid ? `authenticated as ${s.user}` : "gws found (needs auth)");
            } else { emit("gmail", true, "gws found (needs setup)"); }
          } catch { emit("gmail", true, "gws found (needs setup)"); }
        })(),

        // GitHub + gh auth
        (async () => {
          const has = await commandExists("gh");
          if (!has) { emit("github", false, "gh CLI not installed"); return; }
          try {
            const proc = Bun.spawn(["gh", "auth", "status"], { stdout: "pipe", stderr: "pipe" });
            const code = await proc.exited;
            if (code === 0) {
              const out = await new Response(proc.stderr).text();
              const m = out.match(/Logged in to .+ as (.+)/);
              emit("github", true, `authenticated as ${m?.[1] ?? "user"}`);
            } else { emit("github", true, "gh found (needs auth)"); }
          } catch { emit("github", true, "gh found (needs auth)"); }
        })(),

        // osascript → Reminders, Music, Calendar
        (async () => {
          const has = await commandExists("osascript");
          emit("apple_reminders", has, has ? "Reminders.app available" : "Requires macOS");
          emit("apple_music", has, has ? "Music.app available" : "Requires macOS");
          emit("apple_calendar", has, has ? "Calendar.app available" : "Requires macOS");
        })(),

        // mdfind → Recent Files
        (async () => {
          const has = await commandExists("mdfind");
          emit("recent_files", has, has ? "Spotlight available" : "Requires macOS");
        })(),
      ]);

      controller.enqueue(enc.encode("event: done\ndata: {}\n\n"));
      controller.close();
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" },
  });
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
  const body = await req.json() as any;

  const existing = loadConfig();

  // Support both nested { config: ... } and flat wizard format
  if (body.config) {
    const incoming = body.config;
    const merged: Config = {
      core: { ...existing.core, ...incoming.core },
      keys: { ...existing.keys, ...incoming.keys },
      sources: { ...existing.sources, ...incoming.sources },
      daemon: { ...existing.daemon, ...incoming.daemon },
      agent: { ...existing.agent, ...incoming.agent },
      telegram: { ...existing.telegram, ...incoming.telegram },
    };
    saveConfig(merged);
    return Response.json({ ok: true, config: merged });
  }

  // Flat format from setup wizard
  const { provider, model, apiKey, baseUrl, customApiKey, sources, telegramBotToken, telegramChatId } = body;

  const merged: Config = {
    ...existing,
    keys: {
      ...existing.keys,
      ...(provider && apiKey ? { [provider]: apiKey } : {}),
    },
    sources: { ...existing.sources, ...sources },
    agent: {
      ...existing.agent,
      ...(provider ? { provider } : {}),
      ...(model ? { default_model: model } : {}),
      ...(baseUrl ? { base_url: baseUrl } : {}),
      ...(customApiKey ? { api_key: customApiKey } : {}),
    },
    telegram: {
      ...existing.telegram,
      ...(telegramBotToken ? { bot_token: telegramBotToken } : {}),
      ...(telegramChatId ? { chat_ids: [telegramChatId] } : {}),
    },
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
