import { existsSync, readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { getChannel, listChannelNames } from "@cli/channels/channel.ts";
import { KENT_DIR, ensureKentDir } from "@shared/config.ts";

const CHANNEL_PID_PATH = (name: string) => join(KENT_DIR, `channel-${name}.pid`);
const PLIST_LABEL = (name: string) => `sh.kent.channel.${name}`;
const PLIST_PATH = (name: string) =>
  join(homedir(), "Library", "LaunchAgents", `${PLIST_LABEL(name)}.plist`);

const VALID_SUBCOMMANDS = ["start", "stop", "status"] as const;

export async function handleChannel(args: string[]): Promise<void> {
  const sub = args[0] as (typeof VALID_SUBCOMMANDS)[number] | undefined;

  if (!sub || !VALID_SUBCOMMANDS.includes(sub)) {
    console.log(`Usage:
  kent channel start <name>            Start channel in foreground
  kent channel start <name> --daemon   Install as launchd service
  kent channel stop <name>             Stop channel / unload service
  kent channel status                  Show running channels

Available channels: ${listChannelNames().join(", ")}`);
    process.exit(1);
  }

  switch (sub) {
    case "start":
      await channelStart(args.slice(1));
      break;
    case "stop":
      await channelStop(args.slice(1));
      break;
    case "status":
      await channelStatus();
      break;
  }
}

// ── Start ────────────────────────────────────────────────────────────────

async function channelStart(args: string[]): Promise<void> {
  const name = args[0];
  if (!name) {
    console.error(`Usage: kent channel start <name> [--daemon]`);
    console.error(`Available channels: ${listChannelNames().join(", ")}`);
    process.exit(1);
  }

  const isDaemon = args.includes("--daemon");

  if (isDaemon) {
    await installLaunchd(name);
    return;
  }

  // Foreground mode — run the channel directly
  console.log(`Starting channel "${name}" in foreground (Ctrl+C to stop)...`);

  const channel = await getChannel(name);

  // Write PID file for status tracking
  ensureKentDir();
  writeFileSync(CHANNEL_PID_PATH(name), String(process.pid), "utf-8");

  // Handle graceful shutdown
  const cleanup = async () => {
    console.log(`\nShutting down channel "${name}"...`);
    try {
      await channel.stop();
    } catch {
      // Ignore stop errors during shutdown
    }
    try {
      unlinkSync(CHANNEL_PID_PATH(name));
    } catch {
      // Ignore
    }
    process.exit(0);
  };

  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);

  try {
    await channel.start();
  } catch (err) {
    console.error(
      `Channel "${name}" failed: ${err instanceof Error ? err.message : err}`,
    );
    try {
      unlinkSync(CHANNEL_PID_PATH(name));
    } catch {
      // Ignore
    }
    process.exit(1);
  }
}

// ── Stop ─────────────────────────────────────────────────────────────────

async function channelStop(args: string[]): Promise<void> {
  const name = args[0];
  if (!name) {
    console.error("Usage: kent channel stop <name>");
    process.exit(1);
  }

  // Try to unload launchd plist first
  const plistPath = PLIST_PATH(name);
  if (existsSync(plistPath)) {
    console.log(`Unloading launchd service for "${name}"...`);
    const proc = Bun.spawn(["launchctl", "unload", plistPath], {
      stdout: "inherit",
      stderr: "inherit",
    });
    await proc.exited;

    try {
      unlinkSync(plistPath);
    } catch {
      // Ignore
    }
    console.log(`Channel "${name}" launchd service stopped and removed.`);
    return;
  }

  // Try to kill the foreground process via PID file
  const pidPath = CHANNEL_PID_PATH(name);
  if (existsSync(pidPath)) {
    try {
      const pid = parseInt(readFileSync(pidPath, "utf-8").trim(), 10);
      console.log(`Sending SIGTERM to channel "${name}" (PID ${pid})...`);
      process.kill(pid, "SIGTERM");
      unlinkSync(pidPath);
      console.log(`Channel "${name}" stopped.`);
    } catch (err) {
      console.error(
        `Failed to stop channel: ${err instanceof Error ? err.message : err}`,
      );
      // Clean up stale PID file
      try {
        unlinkSync(pidPath);
      } catch {
        // Ignore
      }
    }
    return;
  }

  console.log(`Channel "${name}" does not appear to be running.`);
}

// ── Status ───────────────────────────────────────────────────────────────

async function channelStatus(): Promise<void> {
  const channels = listChannelNames();

  if (channels.length === 0) {
    console.log("No channels registered.");
    return;
  }

  console.log("");
  console.log(padRight("CHANNEL", 15) + padRight("STATUS", 15) + "DETAILS");
  console.log("─".repeat(55));

  for (const name of channels) {
    const pidPath = CHANNEL_PID_PATH(name);
    const plistPath = PLIST_PATH(name);
    let status = "stopped";
    let details = "";

    if (existsSync(plistPath)) {
      // Check if launchd has it loaded
      const proc = Bun.spawn(["launchctl", "list", PLIST_LABEL(name)], {
        stdout: "pipe",
        stderr: "pipe",
      });
      await proc.exited;
      const output = await new Response(proc.stdout).text();
      if (proc.exitCode === 0) {
        status = "running";
        details = "launchd service";
      } else {
        status = "installed";
        details = "launchd plist exists but not loaded";
      }
    } else if (existsSync(pidPath)) {
      try {
        const pid = parseInt(readFileSync(pidPath, "utf-8").trim(), 10);
        // Check if process is alive
        process.kill(pid, 0); // Signal 0 just checks existence
        status = "running";
        details = `PID ${pid} (foreground)`;
      } catch {
        status = "stale";
        details = "PID file exists but process is dead";
        // Clean up stale PID file
        try {
          unlinkSync(pidPath);
        } catch {
          // Ignore
        }
      }
    }

    console.log(padRight(name, 15) + padRight(status, 15) + details);
  }
  console.log("");
}

// ── launchd Installation ─────────────────────────────────────────────────

async function installLaunchd(name: string): Promise<void> {
  const plistPath = PLIST_PATH(name);
  const label = PLIST_LABEL(name);

  // Find the kent executable path
  const kentBin = process.argv[0]; // bun
  const kentScript = process.argv[1]; // cli/index.ts or wherever

  ensureKentDir();
  const logPath = join(KENT_DIR, `channel-${name}.log`);
  const errPath = join(KENT_DIR, `channel-${name}.err`);

  const plistContent = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${label}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${kentBin}</string>
    <string>${kentScript}</string>
    <string>channel</string>
    <string>start</string>
    <string>${name}</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${logPath}</string>
  <key>StandardErrorPath</key>
  <string>${errPath}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>/usr/local/bin:/usr/bin:/bin:/opt/homebrew/bin</string>
  </dict>
</dict>
</plist>`;

  writeFileSync(plistPath, plistContent, "utf-8");
  console.log(`Wrote launchd plist: ${plistPath}`);

  // Load it
  const proc = Bun.spawn(["launchctl", "load", plistPath], {
    stdout: "inherit",
    stderr: "inherit",
  });
  await proc.exited;

  if (proc.exitCode === 0) {
    console.log(`Channel "${name}" installed and started as launchd service.`);
    console.log(`  Logs: ${logPath}`);
    console.log(`  Errors: ${errPath}`);
    console.log(`  Stop with: kent channel stop ${name}`);
  } else {
    console.error(`Failed to load launchd plist (exit code ${proc.exitCode}).`);
    process.exit(1);
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────

function padRight(str: string, len: number): string {
  return str.length >= len ? str + " " : str + " ".repeat(len - str.length);
}
