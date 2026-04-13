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

const SHELL_PATH = [
  process.env.PATH,
  "/opt/homebrew/bin",
  "/opt/homebrew/sbin",
  "/usr/local/bin",
  "/usr/bin",
  "/bin",
  "/sbin",
].filter(Boolean).join(":");

const SHELL_ENV = {
  ...process.env,
  PATH: SHELL_PATH,
};

// Paths to search for CLI binaries. Order matters: Homebrew-first on Apple Silicon,
// then Intel, then system. Covers every layout the user's `gws`/`gh` could live in.
const BINARY_SEARCH_PATHS = [
  "/opt/homebrew/bin",
  "/opt/homebrew/sbin",
  "/usr/local/bin",
  "/usr/local/sbin",
  "/usr/bin",
  "/usr/sbin",
  "/bin",
  "/sbin",
];

/**
 * Resolve a command to its absolute path. In bundled macOS GUI apps launched by
 * launchd, `Bun.which` can return null even when the binary exists because the
 * bundled Bun's PATH lookup sometimes ignores the custom PATH option. So we fall
 * back to walking known locations on disk with `existsSync`, which always works.
 */
function resolveCommand(cmd: string): string | null {
  // If caller passes an absolute path that exists, use it.
  if (cmd.startsWith("/") && existsSync(cmd)) return cmd;

  // First try Bun.which with our explicit SHELL_PATH.
  try {
    const found = Bun.which(cmd, { PATH: SHELL_PATH });
    if (found && existsSync(found)) return found;
  } catch {}

  // Fallback: check each known binary directory on disk.
  for (const dir of BINARY_SEARCH_PATHS) {
    const full = join(dir, cmd);
    if (existsSync(full)) return full;
  }
  return null;
}

async function commandExists(cmd: string): Promise<boolean> {
  return resolveCommand(cmd) !== null;
}

/**
 * Spawn a command using its absolute path (resolved via SHELL_PATH).
 * Falls back to the original arg vector if resolution fails. This avoids
 * PATH resolution quirks in compiled/bundled Bun binaries.
 */
function spawnResolved(args: string[], opts: Parameters<typeof Bun.spawn>[1] = {}) {
  const resolved = resolveCommand(args[0]);
  const finalArgs = resolved ? [resolved, ...args.slice(1)] : args;
  return Bun.spawn(finalArgs, { env: SHELL_ENV, ...opts });
}

function installPrompts(): { copied: number } {
  // In bundled Tauri DMG, Rust passes KENT_PROMPTS_DIR pointing at the resources dir.
  // In dev or compiled-standalone, fall back to the repo's agent/prompts relative to this file.
  const bundledDir =
    process.env.KENT_PROMPTS_DIR ||
    join(dirname(import.meta.path), "..", "..", "agent", "prompts");

  if (!existsSync(bundledDir)) {
    console.warn(`[installPrompts] Source directory not found: ${bundledDir}`);
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
// 2a. GET /api/setup/check-fda — check Full Disk Access WITHOUT any side effects
// ---------------------------------------------------------------------------
// This is the polling endpoint used by the Permissions step. It reads nothing
// from disk except two well-known FDA-gated paths, so calling it repeatedly is
// safe and idempotent. Crucially: it does NOT create ~/.kent, generate a
// device token, or install prompts — all of that is deferred to /api/setup/init
// which is only called once FDA has actually been granted.

export function handleSetupCheckFDA() {
  const imessageDb = join(homedir(), "Library/Messages/chat.db");
  const appleNotesDb = join(homedir(), "Library/Group Containers/group.com.apple.notes/NoteStore.sqlite");
  const hasFullDiskAccess = existsSync(imessageDb) && existsSync(appleNotesDb);
  return Response.json({ hasFullDiskAccess });
}

// ---------------------------------------------------------------------------
// 2b. POST /api/setup/init — gated on FDA. Creates ~/.kent, device token, prompts.
// ---------------------------------------------------------------------------
// Call this ONLY after the user has granted Full Disk Access. This is the
// first point in onboarding where we actually touch the user's disk.

export function handleSetupInit() {
  // Re-verify FDA server-side so this endpoint can't be tricked into running
  // before permissions are granted — even if the client calls it directly.
  const imessageDb = join(homedir(), "Library/Messages/chat.db");
  const appleNotesDb = join(homedir(), "Library/Group Containers/group.com.apple.notes/NoteStore.sqlite");
  const hasFullDiskAccess = existsSync(imessageDb) && existsSync(appleNotesDb);
  if (!hasFullDiskAccess) {
    return Response.json(
      { error: "Full Disk Access not granted — grant it first, then retry." },
      { status: 403 },
    );
  }

  ensureKentDir();

  const deviceToken = randomBytes(32).toString("base64url");

  // Persist the device token to config
  const config = loadConfig();
  config.core.device_token = deviceToken;
  saveConfig(config);

  // Install bundled prompts
  const { copied } = installPrompts();

  return Response.json({
    deviceToken,
    promptsInstalled: copied,
    hasFullDiskAccess: true,
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
          const gwsPath = resolveCommand("gws");
          if (!gwsPath) { emit("gmail", false, `gws CLI not found in ${BINARY_SEARCH_PATHS.join(", ")}`); return; }
          try {
            const proc = spawnResolved(["gws", "auth", "status", "--format", "json"], { stdout: "pipe", stderr: "pipe" });
            const code = await proc.exited;
            if (code === 0) {
              const out = await new Response(proc.stdout).text();
              const s = JSON.parse(out);
              emit("gmail", true, s.token_valid ? `authenticated as ${s.user}` : "gws found (needs auth)");
            } else {
              const err = await new Response(proc.stderr).text();
              emit("gmail", true, `gws ${gwsPath} (exit ${code}): ${err.slice(0, 100) || "needs setup"}`);
            }
          } catch (e) { emit("gmail", true, `gws found at ${gwsPath} but errored: ${String(e).slice(0, 100)}`); }
        })(),

        // GitHub + gh auth
        (async () => {
          const ghPath = resolveCommand("gh");
          if (!ghPath) { emit("github", false, `gh CLI not found in ${BINARY_SEARCH_PATHS.join(", ")}`); return; }
          try {
            const proc = spawnResolved(["gh", "auth", "status"], { stdout: "pipe", stderr: "pipe" });
            const code = await proc.exited;
            if (code === 0) {
              const out = await new Response(proc.stderr).text();
              const m = out.match(/Logged in to \S+ (?:as|account) (\S+)/);
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
    const proc = spawnResolved(["ollama", "list"], { stdout: "pipe", stderr: "pipe" });
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
    const proc = spawnResolved(["brew", "install", "ollama"], { stdout: "pipe", stderr: "pipe" });
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
    const proc = spawnResolved(["ollama", "pull", model], { stdout: "pipe", stderr: "pipe" });
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

function openInTerminal(command: string): void {
  // Escape double quotes for osascript string literal
  const escaped = command.replace(/"/g, '\\"');
  spawnResolved(
    ["osascript", "-e", `tell application "Terminal" to activate`, "-e", `tell application "Terminal" to do script "${escaped}"`],
    { stdout: "ignore", stderr: "ignore" },
  );
}

export async function handleSetupOAuthGmail() {
  const hasGws = await commandExists("gws");
  if (!hasGws) {
    // Open Terminal so user can install + auth interactively
    openInTerminal(`brew install gws && gws auth setup --login && echo '\\n✓ Done — return to Kent and click Refresh'`);
    return Response.json({ ok: true, message: "Terminal opened — install gws and complete OAuth, then click Refresh in Kent." });
  }

  // Check if already authenticated — may succeed now
  try {
    const statusProc = spawnResolved(["gws", "auth", "status", "--format", "json"], { stdout: "pipe", stderr: "pipe" });
    const code = await statusProc.exited;
    if (code === 0) {
      const output = await new Response(statusProc.stdout).text();
      const status = JSON.parse(output);
      if (status.token_valid) {
        return Response.json({ ok: true, authenticated: true, user: status.user });
      }
    }
  } catch {}

  // Not authenticated — open Terminal to run interactive login
  const hasCredentials =
    existsSync(join(homedir(), "Library/Application Support/gws/client_secret.json")) ||
    existsSync(join(homedir(), "Library/Application Support/gws/credentials.enc"));

  const cmd = hasCredentials
    ? `gws auth login -s gmail,calendar,tasks,drive && echo '\\n✓ Done — return to Kent and click Refresh'`
    : `gws auth setup --login && echo '\\n✓ Done — return to Kent and click Refresh'`;
  openInTerminal(cmd);
  return Response.json({ ok: true, message: "Terminal opened — complete OAuth in the terminal, then click Refresh in Kent." });
}

// ---------------------------------------------------------------------------
// 9. POST /api/setup/oauth/github — install gh if needed, run OAuth
// ---------------------------------------------------------------------------

export async function handleSetupOAuthGithub() {
  const hasGh = await commandExists("gh");
  if (!hasGh) {
    openInTerminal(`brew install gh && gh auth login --web -p https && echo '\\n✓ Done — return to Kent and click Refresh'`);
    return Response.json({ ok: true, message: "Terminal opened — install gh and complete OAuth, then click Refresh in Kent." });
  }

  // Check if already authenticated
  try {
    const checkProc = spawnResolved(["gh", "auth", "status"], { stdout: "pipe", stderr: "pipe" });
    if ((await checkProc.exited) === 0) {
      return Response.json({ ok: true, authenticated: true, message: "GitHub already authenticated" });
    }
  } catch {}

  openInTerminal(`gh auth login --web -p https && echo '\\n✓ Done — return to Kent and click Refresh'`);
  return Response.json({ ok: true, message: "Terminal opened — complete OAuth in the terminal, then click Refresh in Kent." });
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
  // Seed any default workflows that are missing by name.
  // Running setup again should top up missing defaults, not do nothing if some exist.
  const existing = await listWorkflows();
  const existingNames = new Set(existing.map((w) => w.name));
  let workflowsCreated = 0;
  for (const wf of DEFAULT_WORKFLOWS) {
    if (existingNames.has(wf.name)) continue;
    try {
      await createWorkflow(wf);
      workflowsCreated++;
    } catch {
      // Duplicate name or other error — skip
    }
  }
  const workflowsTotal = existing.length + workflowsCreated;

  // Fire-and-forget inline sync — runs on this server's event loop, no subprocess.
  // We don't await, so the HTTP response returns immediately and sync continues in the background.
  const config = loadConfig();
  const sourceKeys = Object.entries(config.sources)
    .filter(([_, enabled]) => enabled)
    .map(([key]) => key);

  for (const sourceKey of sourceKeys) {
    const fakeReq = new Request("http://localhost/api/sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ source: sourceKey }),
    });
    // Fire-and-forget — errors swallowed so one bad source doesn't block the rest
    handleSync(fakeReq).catch(() => {});
  }

  return Response.json({ workflowsCreated, workflowsTotal, syncStarted: true });
}

// ---------------------------------------------------------------------------
// 12. POST /api/setup/open-permissions — open System Settings → Full Disk Access
// ---------------------------------------------------------------------------

export async function handleSetupOpenPermissions() {
  try {
    const proc = spawnResolved(
      ["open", "x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles"],
      { stdout: "pipe", stderr: "pipe" }
    );
    await proc.exited;
    return Response.json({ ok: true });
  } catch (e) {
    return Response.json({ ok: false, error: String(e) }, { status: 500 });
  }
}

// ---------------------------------------------------------------------------
// 13. POST /api/setup/start-services — register launchd agents
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
