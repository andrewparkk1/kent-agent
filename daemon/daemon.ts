/**
 * Background daemon — single process, single loop.
 * Each 60s tick:
 *   1. Check if any workflows are due (cron match) → spawn agent
 *   2. Check if sync is due (elapsed time) → fetch sources
 * Writes daemon-state.json for `kent daemon status`. Logs to ~/.kent/daemon.log.
 */
import { appendFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { loadConfig, ensureKentDir, KENT_DIR, PID_PATH, LOG_PATH, DAEMON_STATE_PATH } from "@shared/config.ts";
import { upsertItems, getDueWorkflows, updateWorkflow, createThread, finishThread } from "@shared/db.ts";
import { matchesCron } from "./cron.ts";
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

  const syncState = new FileSyncState();
  let lastSyncAt = 0;

  // Resolve paths for spawning the agent
  const projectRoot = resolve(import.meta.dir, "..");
  const agentPath = resolve(projectRoot, "agent", "agent.ts");
  const bunPath = process.execPath || "bun";

  // ── Workflow executor ──────────────────────────────────────────────
  async function runDueWorkflows(): Promise<void> {
    const now = new Date();
    const nowEpoch = Math.floor(now.getTime() / 1000);
    const workflows = await getDueWorkflows();

    for (const wf of workflows) {
      if (!wf.cron_schedule) continue;
      if (!matchesCron(wf.cron_schedule, now)) continue;

      // Don't re-run if already ran this minute
      if (wf.last_run_at) {
        const lastRunDate = new Date(wf.last_run_at * 1000);
        if (
          lastRunDate.getFullYear() === now.getFullYear() &&
          lastRunDate.getMonth() === now.getMonth() &&
          lastRunDate.getDate() === now.getDate() &&
          lastRunDate.getHours() === now.getHours() &&
          lastRunDate.getMinutes() === now.getMinutes()
        ) {
          continue; // Already ran this minute window
        }
      }

      log(`workflow: running "${wf.name}"`);
      const threadId = await createThread(`workflow: ${wf.name}`, { type: "workflow", workflow_id: wf.id });
      await updateWorkflow(wf.id, { last_run_at: nowEpoch });

      try {
        const env: Record<string, string> = {
          ...process.env as Record<string, string>,
          ANTHROPIC_API_KEY: config.keys.anthropic || process.env.ANTHROPIC_API_KEY || "",
          RUNNER: "workflow",
          THREAD_ID: threadId,
          PROMPT: wf.prompt,
          MODEL: config.agent.default_model,
        };

        const proc = Bun.spawn([bunPath, "run", agentPath], {
          env,
          stdout: "pipe",
          stderr: "pipe",
          cwd: projectRoot,
        });

        await new Response(proc.stdout).text();
        await proc.exited;

        await finishThread(threadId, proc.exitCode === 0 ? "done" : "error");
        log(`workflow: "${wf.name}" ${proc.exitCode === 0 ? "completed" : "failed"}`);
      } catch (e) {
        await finishThread(threadId, "error");
        log(`workflow: "${wf.name}" error — ${e}`);
      }
    }
  }

  // ── Source sync ────────────────────────────────────────────────────
  async function syncSources(): Promise<void> {
    const syncResults: Record<string, number> = {};
    const syncTitles: Record<string, string[]> = {};
    const syncErrors: Record<string, string> = {};

    for (const source of enabledSources) {
      writeDaemonState({
        pid: process.pid,
        status: "syncing",
        currentSource: source.name,
        enabledSources: sourceNames,
        intervalMinutes: config.daemon.sync_interval_minutes,
      });

      try {
        const items = await source.fetchNew(syncState);
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
          // Advance sync cursor to the max item timestamp (high water mark),
          // not "now" — prevents gaps if API data lags behind real time
          const maxCreatedAt = Math.max(...items.map((i) => i.createdAt));
          syncState.markSynced(source.name, maxCreatedAt);
        } else {
          log(`${source.name}: no new items`);
        }
      } catch (e) {
        const errMsg = String(e);
        log(`${source.name}: ERROR — ${errMsg}`);
        syncResults[source.name] = -1;

        if (errMsg.includes("Permission denied") || errMsg.includes("operation not permitted") || errMsg.includes("EPERM")) {
          syncErrors[source.name] = `Permission denied — grant Full Disk Access to: ${bunPath}\n  System Settings → Privacy & Security → Full Disk Access → add ${bunPath}`;
        } else {
          syncErrors[source.name] = errMsg.slice(0, 200);
        }
      }
    }

    lastSyncAt = Date.now();
    writeDaemonState({
      pid: process.pid,
      status: "waiting",
      nextSyncAt: lastSyncAt + intervalMs,
      lastSyncAt,
      lastSyncResults: syncResults,
      lastSyncTitles: syncTitles,
      lastSyncErrors: Object.keys(syncErrors).length > 0 ? syncErrors : undefined,
      enabledSources: sourceNames,
      intervalMinutes: config.daemon.sync_interval_minutes,
    });
  }

  // ── Main loop (60s tick) ───────────────────────────────────────────
  const TICK_MS = 60_000;

  while (true) {
    // 1. Check for due workflows
    try {
      await runDueWorkflows();
    } catch (e) {
      log(`workflow tick error: ${e}`);
    }

    // 2. Sync sources if enough time has passed
    const timeSinceSync = Date.now() - lastSyncAt;
    if (timeSinceSync >= intervalMs) {
      if (enabledSources.length > 0) {
        await syncSources();
      } else {
        log("tick (idle — no sources enabled)");
        lastSyncAt = Date.now();
      }
    }

    await sleep(TICK_MS);
  }
}

main().catch((err) => {
  log(`Fatal error: ${err}`);
  process.exit(1);
});
