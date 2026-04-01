import { appendFileSync, writeFileSync } from "node:fs";
import { loadConfig, ensureKentDir, PID_PATH, LOG_PATH, DAEMON_STATE_PATH } from "@shared/config.ts";
import { upsertItems } from "@shared/db.ts";
import { FileSyncState } from "./sync-state.ts";
import type { Source } from "./sources/types.ts";
import { imessage } from "./sources/imessage.ts";
import { signal } from "./sources/signal.ts";
import { granola } from "./sources/granola.ts";
import { gmail, gcal, gtasks } from "./sources/gmail.ts";
import { github } from "./sources/github.ts";
import { chrome } from "./sources/chrome.ts";
import { appleNotes } from "./sources/apple-notes.ts";

const sourceRegistry: Record<string, Source> = {
  imessage,
  signal,
  granola,
  gmail,
  gcal,
  gtasks,
  github,
  chrome,
  apple_notes: appleNotes,
};

function log(message: string): void {
  const timestamp = new Date().toISOString();
  const line = `[${timestamp}] ${message}\n`;
  try {
    appendFileSync(LOG_PATH, line, "utf-8");
  } catch {
    process.stdout.write(line);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

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
  intervalMinutes: number;
}

/** Extract a human-readable title from a synced item. */
function itemTitle(item: { source: string; content: string; metadata: Record<string, any> }): string {
  const m = item.metadata;
  // Gmail emails
  if (m.subject) return m.subject;
  // Calendar events
  if (m.summary) return m.summary;
  // Tasks
  if (m.type === "task" && m.title) return m.title;
  // Chrome
  if (m.type === "search" && m.term) return `Search: ${m.term}`;
  if (m.type === "bookmark" && m.name) return m.name;
  if (m.type === "download" && m.targetPath) return m.targetPath.split("/").pop() ?? m.targetPath;
  if (m.title) return m.title;
  // GitHub / fallback: first line of content
  return item.content.split("\n")[0]?.slice(0, 120) ?? "(untitled)";
}

function writeDaemonState(state: DaemonState): void {
  try {
    writeFileSync(DAEMON_STATE_PATH, JSON.stringify(state), "utf-8");
  } catch {
    // non-fatal
  }
}

async function main(): Promise<void> {
  ensureKentDir();

  // Write PID file
  writeFileSync(PID_PATH, String(process.pid), "utf-8");
  log(`Daemon started (PID ${process.pid})`);

  const config = loadConfig();
  const intervalMs = config.daemon.sync_interval_minutes * 60 * 1000;

  // Build list of enabled sources
  const enabledSources: Source[] = [];
  for (const [key, source] of Object.entries(sourceRegistry)) {
    const configKey = key as keyof typeof config.sources;
    if (config.sources[configKey]) {
      enabledSources.push(source);
    }
  }

  const sourceNames = enabledSources.map((s) => s.name);

  if (enabledSources.length === 0) {
    log("No sources enabled — daemon will idle. Enable sources in ~/.kent/config.json");
  } else {
    log(`Sources: ${sourceNames.join(", ")}`);
  }

  log(`Sync interval: ${config.daemon.sync_interval_minutes} minutes`);

  // Handle graceful shutdown
  const shutdown = () => {
    log("Daemon shutting down");
    try {
      const { unlinkSync } = require("node:fs");
      unlinkSync(PID_PATH);
      unlinkSync(DAEMON_STATE_PATH);
    } catch {
      // files may already be removed
    }
    process.exit(0);
  };

  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);

  const state = new FileSyncState();

  // Main loop
  while (true) {
    const syncResults: Record<string, number> = {};
    const syncTitles: Record<string, string[]> = {};
    const syncErrors: Record<string, string> = {};

    // Resolve bun path once for error messages
    const bunPath = process.execPath || "bun";

    for (const source of enabledSources) {
      writeDaemonState({
        pid: process.pid,
        status: "syncing",
        currentSource: source.name,
        enabledSources: sourceNames,
        intervalMinutes: config.daemon.sync_interval_minutes,
      });

      try {
        const items = await source.fetchNew(state);
        syncResults[source.name] = items.length;
        syncTitles[source.name] = items.slice(0, 10).map(itemTitle);
        if (items.length > 0) {
          log(`${source.name}: ${items.length} new items — saving to db`);
          const dbItems = items.map((item) => ({
            source: item.source,
            external_id: item.externalId,
            content: item.content,
            metadata: item.metadata,
            created_at: item.createdAt,
          }));
          upsertItems(dbItems);
          log(`${source.name}: save complete`);
        } else {
          log(`${source.name}: no new items`);
        }
        state.markSynced(source.name);
      } catch (e) {
        const errMsg = String(e);
        log(`${source.name}: ERROR — ${errMsg}`);
        syncResults[source.name] = -1;

        // Detect permission errors and provide actionable fix
        if (errMsg.includes("Permission denied") || errMsg.includes("operation not permitted") || errMsg.includes("EPERM")) {
          syncErrors[source.name] = `Permission denied — grant Full Disk Access to: ${bunPath}\n  System Settings → Privacy & Security → Full Disk Access → add ${bunPath}`;
        } else {
          syncErrors[source.name] = errMsg.slice(0, 200);
        }
      }
    }

    if (enabledSources.length === 0) {
      log("tick (idle — no sources enabled)");
    }

    const nextSyncAt = Date.now() + intervalMs;
    writeDaemonState({
      pid: process.pid,
      status: "waiting",
      nextSyncAt,
      lastSyncAt: Date.now(),
      lastSyncResults: syncResults,
      lastSyncTitles: syncTitles,
      lastSyncErrors: Object.keys(syncErrors).length > 0 ? syncErrors : undefined,
      enabledSources: sourceNames,
      intervalMinutes: config.daemon.sync_interval_minutes,
    });

    await sleep(intervalMs);
  }
}

main().catch((err) => {
  log(`Fatal error: ${err}`);
  process.exit(1);
});
