/** Daemon management — start/stop/status/logs for the background sync daemon via launchd. */
/**
 * `kent daemon start|stop|status|logs` — manages the background sync process.
 * The daemon runs as a macOS launchd service that periodically pulls new data from
 * all enabled sources (iMessage, Gmail, GitHub, etc.) and saves it to the local SQLite DB.
 * - start: writes a launchd plist and bootstraps it so syncing runs even when the terminal is closed
 * - stop: kills the daemon process and unloads the plist
 * - status: reads daemon-state.json to show what's syncing, last results, next sync time
 * - logs: tails ~/.kent/daemon.log
 */
import { existsSync, readFileSync, writeFileSync, unlinkSync, watchFile, unwatchFile } from "node:fs";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { PID_PATH, PLIST_PATH, WEB_PLIST_PATH, LOG_PATH, DAEMON_STATE_PATH, KENT_DIR, ensureKentDir } from "@shared/config.ts";
import { stopWeb, installWebLaunchd, uninstallWebLaunchd } from "./web.ts";

const VALID_SUBCOMMANDS = ["start", "stop", "status"] as const;

function generatePlist(): string {
  const projectRoot = resolve(import.meta.dir, import.meta.dir.endsWith("dist") ? ".." : "../..");
  const daemonScript = resolve(projectRoot, "daemon/daemon.ts");
  const bunPath = execFileSync("which", ["bun"], { encoding: "utf-8" }).trim();

  // Capture current PATH so launchd has access to user-installed tools (gh, gws, etc.)
  const userPath = process.env.PATH || "/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin";

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>sh.kent.daemon</string>
  <key>ProgramArguments</key>
  <array>
    <string>${bunPath}</string>
    <string>run</string>
    <string>${daemonScript}</string>
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
  <string>${LOG_PATH}</string>
  <key>StandardErrorPath</key>
  <string>${LOG_PATH}</string>
</dict>
</plist>`;
}

/** Check if a process with the given PID is alive. */
function isProcessAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

export async function daemonStart(): Promise<void> {
  ensureKentDir();

  // If already running, tell the user
  if (existsSync(PID_PATH)) {
    const pid = Number(readFileSync(PID_PATH, "utf-8").trim());
    if (isProcessAlive(pid)) {
      console.log(`Daemon is already running (PID ${pid})`);
      console.log("Run `kent daemon stop` first, or `kent daemon status` to view.");
      return;
    }
    // Stale PID file — clean up
    try { unlinkSync(PID_PATH); } catch {}
  }

  // Install launchd plist so daemon survives sleep/reboot
  const plistContent = generatePlist();
  writeFileSync(PLIST_PATH, plistContent, "utf-8");

  // Unload first in case there's a stale registration
  const uid = process.getuid!();
  try { execFileSync("launchctl", ["bootout", `gui/${uid}`, PLIST_PATH], { stdio: "pipe", timeout: 5000 }); } catch {}

  // Bootstrap the service
  try {
    execFileSync("launchctl", ["bootstrap", `gui/${uid}`, PLIST_PATH], { stdio: "pipe", timeout: 5000 });
  } catch {
    // Fallback to legacy load command
    try {
      execFileSync("launchctl", ["load", "-w", PLIST_PATH], { stdio: "pipe", timeout: 5000 });
    } catch {}
  }

  // Wait briefly for PID file to appear
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    if (existsSync(PID_PATH)) {
      const pid = readFileSync(PID_PATH, "utf-8").trim();
      console.log(`Daemon started via launchd (PID ${pid})`);
      console.log("Service will auto-restart on sleep/reboot.");
      return;
    }
    await new Promise((r) => setTimeout(r, 200));
  }

  console.log("Daemon started via launchd");
  console.log("Service will auto-restart on sleep/reboot.");
}

async function daemonStop(): Promise<void> {
  const uid = process.getuid!();

  // Unload daemon launchd service
  if (existsSync(PLIST_PATH)) {
    try { execFileSync("launchctl", ["bootout", `gui/${uid}`, PLIST_PATH], { stdio: "pipe", timeout: 5000 }); } catch {}
    try { execFileSync("launchctl", ["unload", PLIST_PATH], { stdio: "pipe", timeout: 3000 }); } catch {}
    try { unlinkSync(PLIST_PATH); } catch {}
  }

  // Kill daemon process if still alive
  if (existsSync(PID_PATH)) {
    const pid = Number(readFileSync(PID_PATH, "utf-8").trim());
    if (isProcessAlive(pid)) {
      try { process.kill(pid, "SIGTERM"); } catch {}
      const deadline = Date.now() + 2000;
      while (Date.now() < deadline && isProcessAlive(pid)) {
        await new Promise((r) => setTimeout(r, 100));
      }
      if (isProcessAlive(pid)) {
        try { process.kill(pid, "SIGKILL"); } catch {}
      }
    }
  }

  try { unlinkSync(PID_PATH); } catch {}
  try { unlinkSync(DAEMON_STATE_PATH); } catch {}

  // Also stop web services (both launchd and processes)
  await uninstallWebLaunchd();
  await stopWeb();

  console.log("All services stopped");
}

// ─── Live Status Dashboard ──────────────────────────────────────────────────

const BOLD = "\x1b[1m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const RED = "\x1b[31m";
const CYAN = "\x1b[36m";
const DIM = "\x1b[2m";
const NC = "\x1b[0m";

interface DaemonState {
  pid: number;
  status: "syncing" | "waiting";
  currentSource?: string;
  nextSyncAt?: number;
  lastSyncAt?: number;
  lastSyncResults?: Record<string, number>;
  lastSyncTitles?: Record<string, string[]>;
  lastSyncErrors?: Record<string, string>;
  enabledSources: string[];
  intervalSeconds: number;
}

function readDaemonState(): DaemonState | null {
  try {
    if (!existsSync(DAEMON_STATE_PATH)) return null;
    return JSON.parse(readFileSync(DAEMON_STATE_PATH, "utf-8"));
  } catch {
    return null;
  }
}

function isDaemonRunning(): { running: boolean; pid?: string } {
  if (!existsSync(PID_PATH)) return { running: false };
  const pid = readFileSync(PID_PATH, "utf-8").trim();
  try {
    process.kill(Number(pid), 0);
    return { running: true, pid };
  } catch {
    return { running: false, pid };
  }
}

function getRecentLogs(n = 8): string[] {
  if (!existsSync(LOG_PATH)) return [];
  const content = readFileSync(LOG_PATH, "utf-8").trim();
  if (!content) return [];
  return content.split("\n").slice(-n);
}

function formatCountdown(ms: number): string {
  if (ms <= 0) return "now";
  const totalSec = Math.ceil(ms / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  if (min > 0) return `${min}m ${sec}s`;
  return `${sec}s`;
}

function renderDashboard(): void {
  const { running, pid } = isDaemonRunning();
  const state = readDaemonState();

  // Clear screen and move cursor to top
  process.stdout.write("\x1b[2J\x1b[H");

  // Header
  console.log(`${BOLD}${CYAN}  Kent Daemon${NC}`);
  console.log(`${DIM}  ${"─".repeat(50)}${NC}`);

  // Status
  if (!running) {
    console.log(`  Status:  ${RED}not running${NC}`);
    if (pid) console.log(`  ${DIM}(stale PID ${pid})${NC}`);
    console.log(`\n  ${DIM}Start with: kent daemon start${NC}`);
  } else {
    console.log(`  Status:  ${GREEN}running${NC} ${DIM}(PID ${pid})${NC}`);

    if (state) {
      // Current activity
      if (state.status === "syncing") {
        console.log(`  Activity: ${YELLOW}syncing ${state.currentSource}...${NC}`);
      } else if (state.nextSyncAt) {
        const remaining = state.nextSyncAt - Date.now();
        const countdown = formatCountdown(remaining);
        console.log(`  Next sync: ${CYAN}${countdown}${NC}`);
      }

      console.log(`  Interval: ${state.intervalSeconds}s`);
      console.log(`  Sources:  ${state.enabledSources.join(", ")}`);

      // Last sync results
      if (state.lastSyncResults && state.lastSyncAt) {
        const ago = formatCountdown(Date.now() - state.lastSyncAt);
        console.log(`\n  ${BOLD}Last sync${NC} ${DIM}(${ago} ago)${NC}`);
        for (const [source, count] of Object.entries(state.lastSyncResults)) {
          const titles = state.lastSyncTitles?.[source] ?? [];
          if (count === -1) {
            const errMsg = state.lastSyncErrors?.[source];
            console.log(`    ${RED}✗${NC} ${source}: error`);
            if (errMsg) {
              for (const line of errMsg.split("\n")) {
                console.log(`      ${RED}${line}${NC}`);
              }
            }
          } else if (count > 0) {
            console.log(`    ${GREEN}✓${NC} ${source}: ${count} items`);
            for (const title of titles) {
              const truncated = title.length > 60 ? title.slice(0, 57) + "..." : title;
              console.log(`      ${DIM}→ ${truncated}${NC}`);
            }
            if (count > titles.length) {
              console.log(`      ${DIM}  …and ${count - titles.length} more${NC}`);
            }
          } else {
            console.log(`    ${DIM}·${NC} ${source}: ${DIM}0 items${NC}`);
          }
        }
      }
    }
  }

  // Recent logs
  const logs = getRecentLogs(8);
  if (logs.length > 0) {
    console.log(`\n  ${BOLD}Recent logs${NC}`);
    for (const line of logs) {
      // Parse timestamp and message
      const match = line.match(/^\[([^\]]+)\]\s*(.*)/);
      if (match) {
        const date = new Date(match[1]!);
        const time = isNaN(date.getTime()) ? match[1]! : date.toLocaleTimeString();
        const msg = match[2]!;
        // Color based on content
        if (msg.includes("ERROR")) {
          console.log(`  ${DIM}${time}${NC}  ${RED}${msg}${NC}`);
        } else if (msg.includes("new items")) {
          console.log(`  ${DIM}${time}${NC}  ${GREEN}${msg}${NC}`);
        } else {
          console.log(`  ${DIM}${time}  ${msg}${NC}`);
        }
      } else {
        console.log(`  ${DIM}${line}${NC}`);
      }
    }
  }

  console.log(`\n  ${DIM}ctrl+c to exit${NC}`);
}

async function daemonStatus(): Promise<void> {
  const { running } = isDaemonRunning();

  if (!running) {
    // Not running — just print once and exit
    renderDashboard();
    return;
  }

  // Live mode — refresh every second
  console.log(`${DIM}  Watching daemon... (ctrl+c to stop)${NC}\n`);

  renderDashboard();

  const interval = setInterval(() => {
    renderDashboard();
  }, 1000);

  // Also re-render immediately when daemon state file changes
  if (existsSync(DAEMON_STATE_PATH)) {
    watchFile(DAEMON_STATE_PATH, { interval: 500 }, () => {
      renderDashboard();
    });
  }

  // Handle ctrl+c
  const cleanup = () => {
    clearInterval(interval);
    try { unwatchFile(DAEMON_STATE_PATH); } catch {}
    process.stdout.write("\x1b[?25h"); // show cursor
    process.exit(0);
  };

  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);

  // Keep alive
  await new Promise(() => {});
}

export async function handleDaemon(args: string[]): Promise<void> {
  const sub = args[0] as (typeof VALID_SUBCOMMANDS)[number] | undefined;

  if (!sub || !VALID_SUBCOMMANDS.includes(sub)) {
    console.log("Usage: kent daemon <start|stop|status>");
    process.exit(1);
  }

  switch (sub) {
    case "start":
      await daemonStart();
      break;
    case "stop":
      await daemonStop();
      break;
    case "status":
      await daemonStatus();
      break;
  }
}
