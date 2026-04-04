/**
 * `kent web` — supervisor that owns API + Vite as child processes.
 * Monitors health, respawns on crash, cleans up on exit.
 */
import { resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { KENT_DIR, WEB_PLIST_PATH, LOG_PATH } from "@shared/config.ts";
import type { Subprocess } from "bun";

const API_PORT = 3456;
const VITE_PORT = 5173;

const API_PID_PATH = resolve(KENT_DIR, "web-api.pid");
const VITE_PID_PATH = resolve(KENT_DIR, "web-vite.pid");

// ─── Helpers ──────────────────────────────────────────────────────────────

function isProcessAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

function killPid(pid: number): void {
  try { process.kill(pid, "SIGTERM"); } catch {}
  // Give it a moment, then force kill
  setTimeout(() => {
    try { process.kill(pid, "SIGKILL"); } catch {}
  }, 2000);
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
    // Vite returns 200 with HTML, API returns 404 on "/" but that means it's alive
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

const projectRoot = resolve(import.meta.dir, import.meta.dir.endsWith("dist") ? ".." : "../..");
const webDir = resolve(projectRoot, "web");
const bunPath = execFileSync("which", ["bun"], { encoding: "utf-8" }).trim();

function spawnApi(): Subprocess {
  const serverScript = resolve(webDir, "server.ts");
  const logFile = resolve(KENT_DIR, "web-api.log");
  const proc = Bun.spawn([bunPath, "run", serverScript], {
    cwd: webDir,
    stdout: Bun.file(logFile),
    stderr: Bun.file(logFile),
    stdin: "ignore",
  });
  writePid(API_PID_PATH, proc.pid);
  return proc;
}

function spawnVite(): Subprocess {
  const bunxPath = execFileSync("which", ["bunx"], { encoding: "utf-8" }).trim();
  const logFile = resolve(KENT_DIR, "web-vite.log");
  const proc = Bun.spawn([bunxPath, "vite", "--port", String(VITE_PORT)], {
    cwd: webDir,
    stdout: Bun.file(logFile),
    stderr: Bun.file(logFile),
    stdin: "ignore",
  });
  writePid(VITE_PID_PATH, proc.pid);
  return proc;
}

// ─── Supervisor ───────────────────────────────────────────────────────────

export async function handleWeb(): Promise<void> {
  // Kill any stale processes on our ports
  await Promise.all([
    killStaleProcess(API_PORT, API_PID_PATH),
    killStaleProcess(VITE_PORT, VITE_PID_PATH),
  ]);

  let apiProc = spawnApi();
  let viteProc = spawnVite();
  let shuttingDown = false;

  console.log(`Starting Kent web supervisor (PID ${process.pid})...`);

  // Wait for both to be healthy
  const [apiReady, viteReady] = await Promise.all([
    waitForHealthy(API_PORT),
    waitForHealthy(VITE_PORT),
  ]);

  if (!apiReady) console.log("Warning: API server may not have started — check ~/.kent/web-api.log");
  if (!viteReady) console.log("Warning: Vite dev server may not have started — check ~/.kent/web-vite.log");

  // Open browser
  try {
    execFileSync("open", [`http://localhost:${VITE_PORT}`]);
  } catch {
    console.log(`Open http://localhost:${VITE_PORT} in your browser`);
  }

  console.log(`Dashboard: http://localhost:${VITE_PORT}`);
  console.log(`API:       http://localhost:${API_PORT}`);
  console.log("Supervisor running — Ctrl+C to stop\n");

  // ─── Clean shutdown ─────────────────────────────────────────────────

  function cleanup() {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log("\nShutting down...");

    // Kill children
    try { apiProc.kill(); } catch {}
    try { viteProc.kill(); } catch {}

    removePid(API_PID_PATH);
    removePid(VITE_PID_PATH);

    console.log("Web services stopped.");
    process.exit(0);
  }

  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);

  // ─── Health check loop ──────────────────────────────────────────────

  const CHECK_INTERVAL = 5000;
  const MAX_RESTARTS = 10;
  let apiRestarts = 0;
  let viteRestarts = 0;

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
        apiRestarts = Math.max(0, apiRestarts - 1); // Decay restart counter on success
      } else {
        console.log("API server failed to restart — will retry...");
      }
    } else {
      apiRestarts = Math.max(0, apiRestarts - 1); // Decay when healthy
    }

    // Check Vite
    if (viteProc.exitCode !== null || !(await isPortHealthy(VITE_PORT))) {
      if (viteRestarts >= MAX_RESTARTS) {
        console.log(`Vite server failed ${MAX_RESTARTS} times — giving up. Check ~/.kent/web-vite.log`);
        continue;
      }
      viteRestarts++;
      console.log(`Vite server died — restarting (attempt ${viteRestarts})...`);
      try { viteProc.kill(); } catch {}
      await killStaleProcess(VITE_PORT, VITE_PID_PATH);
      viteProc = spawnVite();
      const ok = await waitForHealthy(VITE_PORT, 10000);
      if (ok) {
        console.log("Vite server restarted successfully.");
        viteRestarts = Math.max(0, viteRestarts - 1);
      } else {
        console.log("Vite server failed to restart — will retry...");
      }
    } else {
      viteRestarts = Math.max(0, viteRestarts - 1);
    }
  }
}

/** Kill web services (called from `kent daemon stop` or similar). */
export async function stopWeb(): Promise<void> {
  await Promise.all([
    killStaleProcess(API_PORT, API_PID_PATH),
    killStaleProcess(VITE_PORT, VITE_PID_PATH),
  ]);
  console.log("Web services stopped.");
}

// ─── Launchd support ─────────────────────────────────────────────────────

function generateWebPlist(): string {
  const webScript = resolve(projectRoot, "cli/index.ts");
  const userPath = process.env.PATH || "/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin";

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>sh.kent.web</string>
  <key>ProgramArguments</key>
  <array>
    <string>${bunPath}</string>
    <string>run</string>
    <string>${webScript}</string>
    <string>web</string>
  </array>
  <key>WorkingDirectory</key>
  <string>${projectRoot}</string>
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
