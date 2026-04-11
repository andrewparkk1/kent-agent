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
import { matchesCron, getNextCronTime } from "./cron.ts";
import { FileSyncState } from "./sync-state.ts";
import type { Source } from "./sources/types.ts";
import { imessage } from "./sources/imessage.ts";
import { signal } from "./sources/signal.ts";
import { granola } from "./sources/granola.ts";
import { gmail, gcal, gtasks } from "./sources/gmail.ts";
import { github } from "./sources/github.ts";
import { chrome } from "./sources/chrome.ts";
import { appleNotes } from "./sources/apple-notes.ts";
import { aiCoding } from "./sources/ai-coding.ts";
import { getChannels } from "@shared/channels/index.ts";
import { notifyAllChannels, formatWorkflowNotification } from "@shared/channels/notify.ts";
import { startChannelPolling } from "./channel-handler.ts";

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
  ai_coding: aiCoding,
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

/** Send a workflow notification to all configured channels. */
async function notifyWorkflowRun(
  workflowName: string,
  threadId: string,
  success: boolean,
  output: string,
): Promise<void> {
  const channels = getChannels(loadConfig());
  if (channels.length === 0) return;

  const body = formatWorkflowNotification(workflowName, success, output);
  await notifyAllChannels(channels, body, threadId, log);
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
  intervalSeconds: number;
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

  let config = loadConfig();
  let intervalMs = config.daemon.sync_interval_seconds * 1000;

  function reloadConfig() {
    const prev = config;
    config = loadConfig();
    intervalMs = config.daemon.sync_interval_seconds * 1000;

    const prevSources = Object.entries(prev.sources).filter(([, v]) => v).map(([k]) => k).sort().join(",");
    const newSources = Object.entries(config.sources).filter(([, v]) => v).map(([k]) => k).sort().join(",");
    if (prevSources !== newSources) {
      log(`Config reloaded — sources changed: ${newSources || "(none)"}`);
    }
    if (prev.daemon.sync_interval_seconds !== config.daemon.sync_interval_seconds) {
      log(`Config reloaded — sync interval: ${config.daemon.sync_interval_seconds}s`);
    }
  }

  function getEnabledSources(): { sources: Source[]; names: string[] } {
    const sources: Source[] = [];
    for (const [key, source] of Object.entries(sourceRegistry)) {
      const configKey = key as keyof typeof config.sources;
      if (config.sources[configKey]) {
        sources.push(source);
      }
    }
    return { sources, names: sources.map((s) => s.name) };
  }

  const { names: initialNames } = getEnabledSources();
  if (initialNames.length === 0) {
    log("No sources enabled — daemon will idle. Enable sources in ~/.kent/config.json");
  } else {
    log(`Sources: ${initialNames.join(", ")}`);
  }

  log(`Sync interval: ${config.daemon.sync_interval_seconds}s`);

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
  const agentBin = process.env.KENT_AGENT_BIN;
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

      let shouldRun = false;

      if (matchesCron(wf.cron_schedule, now)) {
        // Cron matches right now — run unless we already ran this minute
        shouldRun = true;
        if (wf.last_run_at) {
          const lastRunDate = new Date(wf.last_run_at * 1000);
          if (
            lastRunDate.getFullYear() === now.getFullYear() &&
            lastRunDate.getMonth() === now.getMonth() &&
            lastRunDate.getDate() === now.getDate() &&
            lastRunDate.getHours() === now.getHours() &&
            lastRunDate.getMinutes() === now.getMinutes()
          ) {
            shouldRun = false; // Already ran this minute window
          }
        }
      } else if (wf.last_run_at) {
        // Cron doesn't match now — check if we missed a run (e.g. laptop was asleep)
        const lastRanDate = new Date(wf.last_run_at * 1000);
        const nextDue = getNextCronTime(wf.cron_schedule, lastRanDate);
        if (nextDue && nextDue.getTime() < now.getTime()) {
          log(`workflow: "${wf.name}" missed run at ${nextDue.toISOString()}, catching up now`);
          shouldRun = true;
        }
      }

      if (!shouldRun) continue;

      log(`workflow: running "${wf.name}"`);
      await updateWorkflow(wf.id, { last_run_at: nowEpoch });

      const maxAttempts = 2;
      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        const threadId = await createThread(`workflow: ${wf.name}`, { type: "workflow", workflow_id: wf.id });

        try {
          const env: Record<string, string> = {
            ...process.env as Record<string, string>,
            ANTHROPIC_API_KEY: config.keys.anthropic || process.env.ANTHROPIC_API_KEY || "",
            RUNNER: "workflow",
            THREAD_ID: threadId,
            PROMPT: wf.prompt,
            MODEL: config.agent.default_model,
          };

          const proc = agentBin
            ? Bun.spawn([agentBin], { env, stdout: "pipe", stderr: "pipe" })
            : Bun.spawn([bunPath, "run", agentPath], { env, stdout: "pipe", stderr: "pipe", cwd: projectRoot });

          const agentOutput = await new Response(proc.stdout).text();
          await proc.exited;

          const success = proc.exitCode === 0;
          await finishThread(threadId, success ? "done" : "error");

          // Send Telegram notification
          notifyWorkflowRun(wf.name, threadId, success, agentOutput).catch(() => {});

          if (success) {
            log(`workflow: "${wf.name}" completed`);
            break;
          } else if (attempt < maxAttempts) {
            log(`workflow: "${wf.name}" failed (attempt ${attempt}/${maxAttempts}), retrying...`);
          } else {
            log(`workflow: "${wf.name}" failed after ${maxAttempts} attempts`);
          }
        } catch (e) {
          await finishThread(threadId, "error");
          notifyWorkflowRun(wf.name, threadId, false, String(e)).catch(() => {});
          if (attempt < maxAttempts) {
            log(`workflow: "${wf.name}" error (attempt ${attempt}/${maxAttempts}), retrying — ${e}`);
          } else {
            log(`workflow: "${wf.name}" error after ${maxAttempts} attempts — ${e}`);
          }
        }
      }
    }
  }

  // ── Source sync ────────────────────────────────────────────────────
  async function syncSources(): Promise<void> {
    const { sources: enabledSources, names: sourceNames } = getEnabledSources();
    const syncResults: Record<string, number> = {};
    const syncTitles: Record<string, string[]> = {};
    const syncErrors: Record<string, string> = {};

    for (const source of enabledSources) {
      writeDaemonState({
        pid: process.pid,
        status: "syncing",
        currentSource: source.name,
        enabledSources: sourceNames,
        intervalSeconds: config.daemon.sync_interval_seconds,
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
    const { names: currentNames } = getEnabledSources();
    writeDaemonState({
      pid: process.pid,
      status: "waiting",
      nextSyncAt: lastSyncAt + intervalMs,
      lastSyncAt,
      lastSyncResults: syncResults,
      lastSyncTitles: syncTitles,
      lastSyncErrors: Object.keys(syncErrors).length > 0 ? syncErrors : undefined,
      enabledSources: currentNames,
      intervalSeconds: config.daemon.sync_interval_seconds,
    });
  }

  // ── Channel polling (runs in background per channel) ────────────────
  const channels = getChannels(config);
  if (channels.length > 0) {
    for (const channel of channels) {
      log(`Channel "${channel.name}" enabled — starting polling`);
      startChannelPolling(channel, log).catch((e) => log(`${channel.name} polling fatal: ${e}`));
    }
  } else {
    log("No channels configured — skipping. Set telegram.bot_token and telegram.chat_id in config.");
  }

  // ── Main loop (60s tick) ───────────────────────────────────────────
  const TICK_MS = 60_000;

  while (true) {
    // Reload config each tick so changes take effect without restart
    reloadConfig();

    // 1. Check for due workflows
    try {
      await runDueWorkflows();
    } catch (e) {
      log(`workflow tick error: ${e}`);
    }

    // 2. Sync sources if enough time has passed
    const timeSinceSync = Date.now() - lastSyncAt;
    if (timeSinceSync >= intervalMs) {
      const { sources: currentSources } = getEnabledSources();
      if (currentSources.length > 0) {
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
