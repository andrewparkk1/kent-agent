import { appendFileSync, writeFileSync } from "node:fs";
import { loadConfig, ensureKentDir, PID_PATH, LOG_PATH } from "@shared/config.ts";

function log(message: string): void {
  const timestamp = new Date().toISOString();
  const line = `[${timestamp}] ${message}\n`;
  try {
    appendFileSync(LOG_PATH, line, "utf-8");
  } catch {
    // If log file isn't writable, write to stdout as fallback
    process.stdout.write(line);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main(): Promise<void> {
  ensureKentDir();

  // Write PID file
  writeFileSync(PID_PATH, String(process.pid), "utf-8");
  log(`Daemon started (PID ${process.pid})`);

  const config = loadConfig();
  const intervalMs = config.daemon.sync_interval_minutes * 60 * 1000;

  log(`Sync interval: ${config.daemon.sync_interval_minutes} minutes`);

  // Handle graceful shutdown
  const shutdown = () => {
    log("Daemon shutting down");
    try {
      const { unlinkSync } = require("node:fs");
      unlinkSync(PID_PATH);
    } catch {
      // PID file may already be removed
    }
    process.exit(0);
  };

  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);

  // Main loop
  while (true) {
    log("tick");
    await sleep(intervalMs);
  }
}

main().catch((err) => {
  log(`Fatal error: ${err}`);
  process.exit(1);
});
