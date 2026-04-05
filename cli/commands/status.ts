/** `kent status` — shows if all services are up and running. */
import { existsSync, readFileSync } from "node:fs";
import { PID_PATH, PLIST_PATH, WEB_PLIST_PATH, DAEMON_STATE_PATH, KENT_DIR } from "@shared/config.ts";
import { resolve } from "node:path";

const BOLD = "\x1b[1m";
const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const CYAN = "\x1b[36m";
const DIM = "\x1b[2m";
const YELLOW = "\x1b[33m";
const NC = "\x1b[0m";

const API_PORT = 3456;

function isProcessAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

async function isPortUp(port: number): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2000);
    const res = await fetch(`http://localhost:${port}/`, { signal: controller.signal });
    clearTimeout(timeout);
    return res.status < 500;
  } catch {
    return false;
  }
}

function checkLaunchd(label: string): "loaded" | "not loaded" {
  try {
    const result = Bun.spawnSync(["launchctl", "print", `gui/${process.getuid!()}/${label}`], { stdout: "pipe", stderr: "pipe" });
    return result.exitCode === 0 ? "loaded" : "not loaded";
  } catch {
    return "not loaded";
  }
}

export async function handleStatus(): Promise<void> {
  console.log(`\n${BOLD}${CYAN}  Kent Status${NC}`);
  console.log(`${DIM}  ${"─".repeat(50)}${NC}\n`);

  // ─── Daemon ────────────────────────────────────────────────────────
  const daemonLaunchd = checkLaunchd("sh.kent.daemon");
  let daemonPid: string | null = null;
  let daemonAlive = false;

  if (existsSync(PID_PATH)) {
    daemonPid = readFileSync(PID_PATH, "utf-8").trim();
    daemonAlive = isProcessAlive(Number(daemonPid));
  }

  const daemonIcon = daemonAlive ? `${GREEN}●${NC}` : `${RED}●${NC}`;
  const daemonStatus = daemonAlive
    ? `${GREEN}running${NC} ${DIM}(PID ${daemonPid})${NC}`
    : `${RED}stopped${NC}`;
  const daemonPersist = daemonLaunchd === "loaded"
    ? `${GREEN}launchd${NC}`
    : `${RED}not persistent${NC}`;

  console.log(`  ${daemonIcon} Daemon:     ${daemonStatus}`);
  console.log(`    ${DIM}Persistence:${NC} ${daemonPersist}`);

  // Show last sync info
  if (existsSync(DAEMON_STATE_PATH)) {
    try {
      const state = JSON.parse(readFileSync(DAEMON_STATE_PATH, "utf-8"));
      if (state.lastSyncAt) {
        const ago = Math.round((Date.now() - state.lastSyncAt) / 1000);
        const agoStr = ago > 3600 ? `${Math.round(ago / 3600)}h ago` : ago > 60 ? `${Math.round(ago / 60)}m ago` : `${ago}s ago`;
        console.log(`    ${DIM}Last sync:${NC}   ${agoStr}`);
      }
      if (state.enabledSources) {
        console.log(`    ${DIM}Sources:${NC}     ${state.enabledSources.length} enabled`);
      }
    } catch {}
  }

  // ─── Web (API + Dashboard) ──────────────────────────────────────────
  const apiUp = await isPortUp(API_PORT);
  const apiIcon = apiUp ? `${GREEN}●${NC}` : `${RED}●${NC}`;
  const apiStatus = apiUp
    ? `${GREEN}running${NC} ${DIM}(port ${API_PORT})${NC}`
    : `${RED}stopped${NC}`;
  console.log(`\n  ${apiIcon} Web:        ${apiStatus}`);

  const webLaunchd = checkLaunchd("sh.kent.web");
  const webPersist = webLaunchd === "loaded"
    ? `${GREEN}launchd${NC}`
    : `${RED}not persistent${NC}`;
  console.log(`    ${DIM}Persistence:${NC} ${webPersist}`);

  // ─── Summary ───────────────────────────────────────────────────────
  const allUp = daemonAlive && apiUp;
  const allPersistent = daemonLaunchd === "loaded" && webLaunchd === "loaded";

  console.log(`\n${DIM}  ${"─".repeat(50)}${NC}`);

  if (allUp && allPersistent) {
    console.log(`  ${GREEN}${BOLD}All services running and persistent.${NC}`);
  } else if (allUp) {
    console.log(`  ${YELLOW}Services running but not persistent.${NC}`);
    console.log(`  ${DIM}Run \`kent run\` to install launchd services.${NC}`);
  } else {
    console.log(`  ${RED}Some services are down.${NC}`);
    console.log(`  ${DIM}Run \`kent run\` to start all services.${NC}`);
  }

  console.log();
}
