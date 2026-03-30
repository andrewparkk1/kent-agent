import { existsSync, readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { PID_PATH, PLIST_PATH, LOG_PATH, ensureKentDir } from "@shared/config.ts";

const VALID_SUBCOMMANDS = ["start", "stop", "status"] as const;

function generatePlist(): string {
  const projectRoot = resolve(import.meta.dir, "../..");
  const daemonScript = resolve(projectRoot, "daemon/daemon.ts");
  const bunPath = execFileSync("which", ["bun"], { encoding: "utf-8" }).trim();

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

async function daemonStart(): Promise<void> {
  ensureKentDir();

  const plist = generatePlist();
  writeFileSync(PLIST_PATH, plist, "utf-8");
  console.log(`Wrote plist to ${PLIST_PATH}`);

  try {
    execFileSync("launchctl", ["load", PLIST_PATH], { stdio: "inherit" });
    console.log("Daemon started via launchctl");
  } catch (err) {
    console.error("Failed to load launchd plist:", err);
    process.exit(1);
  }
}

async function daemonStop(): Promise<void> {
  if (!existsSync(PLIST_PATH)) {
    console.log("Daemon is not installed (no plist found)");
    process.exit(1);
  }

  try {
    execFileSync("launchctl", ["unload", PLIST_PATH], { stdio: "inherit" });
    console.log("Daemon stopped via launchctl");
  } catch (err) {
    console.error("Failed to unload launchd plist:", err);
  }

  if (existsSync(PID_PATH)) {
    unlinkSync(PID_PATH);
    console.log("Removed PID file");
  }
}

async function daemonStatus(): Promise<void> {
  // Check launchctl registration
  let launchctlLoaded = false;
  try {
    const output = execFileSync("launchctl", ["list", "sh.kent.daemon"], {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    });
    launchctlLoaded = true;
    const pidMatch = output.match(/"PID"\s*=\s*(\d+)/);
    if (pidMatch) {
      console.log(`Daemon status: running (PID ${pidMatch[1]}, managed by launchctl)`);
      return;
    }
  } catch {
    // not registered with launchctl
  }

  // Check PID file
  if (existsSync(PID_PATH)) {
    const pid = readFileSync(PID_PATH, "utf-8").trim();
    try {
      process.kill(Number(pid), 0);
      console.log(`Daemon status: running (PID ${pid})`);
      return;
    } catch {
      console.log(`Daemon status: stale PID file (PID ${pid} not found)`);
      return;
    }
  }

  if (launchctlLoaded) {
    console.log("Daemon status: registered with launchctl but not running (likely crashing on startup)");
    console.log(`  Check logs: tail -20 ${LOG_PATH}`);
  } else {
    console.log("Daemon status: not running");
  }
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
