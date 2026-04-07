/**
 * `kent web` — supervisor that owns the API server as a child process.
 * Monitors health, respawns on crash, cleans up on exit.
 */
import { resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { KENT_DIR, WEB_PLIST_PATH, LOG_PATH, API_PORT } from "@shared/config.ts";
import type { Subprocess } from "bun";

const API_PID_PATH = resolve(KENT_DIR, "web-api.pid");

// ─── Helpers ──────────────────────────────────────────────────────────────

function isProcessAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

function killPid(pid: number): void {
  try { process.kill(pid, "SIGTERM"); } catch {}
  // Give it a moment, then force kill
  const timer = setTimeout(() => {
    try { process.kill(pid, "SIGKILL"); } catch {}
  }, 2000);
  timer.unref();
}

function readPid(path: string): number | null {
  try {
    if (!existsSync(path)) return null;
    const pid = Number(readFileSync(path, "utf-8").trim());
    return Number.isFinite(pid) && pid > 0 ? pid : null;
  } catch { return null; }
}

function writePid(path: string, pid: number): void {
  try { writeFileSync(path, String(pid), "utf-8"); } catch {}
}

function removePid(path: string): void {
  try { unlinkSync(path); } catch {}
}

async function isPortHealthy(port: number, path = "/"): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);
    const res = await fetch(`http://localhost:${port}${path}`, { signal: controller.signal });
    clearTimeout(timeout);
    return res.status < 500;
  } catch {
    return false;
  }
}

async function waitForHealthy(port: number, timeoutMs = 15000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await isPortHealthy(port)) return true;
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

/** Kill any existing process on the given port or from a stale PID file. */
async function killStaleProcess(port: number, pidPath: string): Promise<void> {
  // First try PID file
  const savedPid = readPid(pidPath);
  if (savedPid && isProcessAlive(savedPid)) {
    killPid(savedPid);
    // Wait for it to die
    const deadline = Date.now() + 3000;
    while (Date.now() < deadline && isProcessAlive(savedPid)) {
      await new Promise((r) => setTimeout(r, 200));
    }
  }
  removePid(pidPath);

  // Also check if something else is on the port (e.g. orphaned process)
  try {
    const result = Bun.spawnSync(["lsof", "-ti", `:${port}`]);
    const pids = result.stdout.toString().trim().split("\n").filter(Boolean).map(Number);
    for (const pid of pids) {
      if (pid > 0 && pid !== process.pid) {
        killPid(pid);
      }
    }
    if (pids.length > 0) {
      await new Promise((r) => setTimeout(r, 1000));
    }
  } catch {}
}

// ─── Process spawning ─────────────────────────────────────────────────────

function getProjectRoot(): string {
  return resolve(import.meta.dir, import.meta.dir.endsWith("dist") ? ".." : "../..");
}

function getBunPath(): string {
  return process.execPath || execFileSync("which", ["bun"], { encoding: "utf-8" }).trim();
}

function spawnApi(): Subprocess {
  const root = getProjectRoot();
  const webDir = resolve(root, "web");
  const serverScript = resolve(webDir, "server.ts");
  const logFile = resolve(KENT_DIR, "web-api.log");
  const bun = getBunPath();
  const proc = Bun.spawn([bun, "--hot", serverScript], {
    cwd: webDir,
    stdout: Bun.file(logFile),
    stderr: Bun.file(logFile),
    stdin: "ignore",
  });
  writePid(API_PID_PATH, proc.pid);
  return proc;
}

// ─── Supervisor ───────────────────────────────────────────────────────────

export async function handleWeb(): Promise<void> {
  // Kill stale processes
  await killStaleProcess(API_PORT, API_PID_PATH);

  let apiProc = spawnApi();
  let shuttingDown = false;

  console.log(`Starting Kent web supervisor (PID ${process.pid})...`);
  console.log("Serving pre-built frontend from web/dist/");

  // Wait for API to be healthy
  const apiReady = await waitForHealthy(API_PORT);
  if (!apiReady) console.log("Warning: API server may not have started — check ~/.kent/web-api.log");

  // Only open browser when run interactively (not from launchd)
  if (process.stdout.isTTY) {
    try {
      execFileSync("open", [`http://localhost:${API_PORT}`]);
    } catch {
      console.log(`Open http://localhost:${API_PORT} in your browser`);
    }
  }

  console.log(`Dashboard: http://localhost:${API_PORT}`);
  console.log("Supervisor running — Ctrl+C to stop\n");

  // ─── Clean shutdown ─────────────────────────────────────────────────

  function cleanup() {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log("\nShutting down...");

    try { apiProc.kill(); } catch {}

    removePid(API_PID_PATH);

    console.log("Web services stopped.");
    process.exit(0);
  }

  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);

  // ─── Health check loop ──────────────────────────────────────────────

  const CHECK_INTERVAL = 5000;
  const MAX_RESTARTS = 10;
  let apiRestarts = 0;

  while (!shuttingDown) {
    await new Promise((r) => setTimeout(r, CHECK_INTERVAL));
    if (shuttingDown) break;

    // Check API
    if (apiProc.exitCode !== null || !(await isPortHealthy(API_PORT))) {
      if (apiRestarts >= MAX_RESTARTS) {
        console.log(`API server failed ${MAX_RESTARTS} times — giving up. Check ~/.kent/web-api.log`);
        continue;
      }
      apiRestarts++;
      console.log(`API server died — restarting (attempt ${apiRestarts})...`);
      try { apiProc.kill(); } catch {}
      await killStaleProcess(API_PORT, API_PID_PATH);
      apiProc = spawnApi();
      const ok = await waitForHealthy(API_PORT, 10000);
      if (ok) {
        console.log("API server restarted successfully.");
        apiRestarts = Math.max(0, apiRestarts - 1);
      } else {
        console.log("API server failed to restart — will retry...");
      }
    } else {
      apiRestarts = Math.max(0, apiRestarts - 1);
    }
  }
}

/** Kill web services (called from `kent daemon stop` or similar). */
export async function stopWeb(): Promise<void> {
  await killStaleProcess(API_PORT, API_PID_PATH);
  console.log("Web services stopped.");
}

// ─── Launchd support ─────────────────────────────────────────────────────

function generateWebPlist(): string {
  const root = getProjectRoot();
  const bun = getBunPath();
  const webScript = resolve(root, "cli/index.ts");
  const userPath = process.env.PATH || "/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin";

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>sh.kent.web</string>
  <key>ProgramArguments</key>
  <array>
    <string>${bun}</string>
    <string>run</string>
    <string>${webScript}</string>
    <string>web</string>
  </array>
  <key>WorkingDirectory</key>
  <string>${root}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>${userPath}</string>
    <key>HOME</key>
    <string>${process.env.HOME || ""}</string>
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${resolve(KENT_DIR, "web-supervisor.log")}</string>
  <key>StandardErrorPath</key>
  <string>${resolve(KENT_DIR, "web-supervisor.log")}</string>
</dict>
</plist>`;
}

/** Install web supervisor as a launchd service so it survives sleep/reboot. */
export function installWebLaunchd(): void {
  const plistContent = generateWebPlist();
  writeFileSync(WEB_PLIST_PATH, plistContent, "utf-8");

  const uid = process.getuid!();
  // Unload first in case there's a stale registration
  try { execFileSync("launchctl", ["bootout", `gui/${uid}`, WEB_PLIST_PATH], { stdio: "pipe", timeout: 5000 }); } catch {}

  try {
    execFileSync("launchctl", ["bootstrap", `gui/${uid}`, WEB_PLIST_PATH], { stdio: "pipe", timeout: 5000 });
  } catch {
    try {
      execFileSync("launchctl", ["load", "-w", WEB_PLIST_PATH], { stdio: "pipe", timeout: 3000 });
    } catch {}
  }
}

/** Uninstall web supervisor launchd service. */
export async function uninstallWebLaunchd(): Promise<void> {
  if (!existsSync(WEB_PLIST_PATH)) return;
  const uid = process.getuid!();
  try { execFileSync("launchctl", ["bootout", `gui/${uid}`, WEB_PLIST_PATH], { stdio: "pipe", timeout: 5000 }); } catch {}
  try { execFileSync("launchctl", ["unload", WEB_PLIST_PATH], { stdio: "pipe", timeout: 3000 }); } catch {}
  try { unlinkSync(WEB_PLIST_PATH); } catch {}
}
