/** Setup API endpoints — mirrors the CLI `kent init` wizard for the web UI. */
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import {
  Config,
  CONFIG_PATH,
  DEFAULT_CONFIG,
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
// 4. GET /api/setup/check-sources — check prerequisites for all 8 sources
// ---------------------------------------------------------------------------

export async function handleSetupCheckSources() {
  const home = homedir();

  const results: Record<string, { ok: boolean; message: string }> = {};

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
    const hasSqlcipher = await commandExists("sqlcipher");
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
  const hasGws = await commandExists("gws");
  if (!hasGws) {
    results.gmail = { ok: false, message: "gws CLI not installed" };
  } else {
    try {
      const proc = Bun.spawn(["gws", "auth", "status", "--format", "json"], { stdout: "pipe", stderr: "pipe" });
      const code = await proc.exited;
      if (code === 0) {
        const output = await new Response(proc.stdout).text();
        const status = JSON.parse(output);
        if (status.token_valid) {
          results.gmail = { ok: true, message: `authenticated as ${status.user}` };
        } else {
          results.gmail = { ok: true, message: "gws found (needs auth)" };
        }
      } else {
        results.gmail = { ok: true, message: "gws found (needs setup)" };
      }
    } catch {
      results.gmail = { ok: true, message: "gws found (needs setup)" };
    }
  }

  // GitHub
  const hasGh = await commandExists("gh");
  if (!hasGh) {
    results.github = { ok: false, message: "gh CLI not installed" };
  } else {
    try {
      const proc = Bun.spawn(["gh", "auth", "status"], { stdout: "pipe", stderr: "pipe" });
      const code = await proc.exited;
      if (code === 0) {
        const output = await new Response(proc.stderr).text();
        const match = output.match(/Logged in to .+ as (.+)/);
        const user = match?.[1] ?? "authenticated";
        results.github = { ok: true, message: `authenticated as ${user}` };
      } else {
        results.github = { ok: true, message: "gh found (needs auth)" };
      }
    } catch {
      results.github = { ok: true, message: "gh found (needs auth)" };
    }
  }

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

  return Response.json({ sources: results });
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
