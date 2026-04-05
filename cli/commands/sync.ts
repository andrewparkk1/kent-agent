/**
 * `kent sync [--source <name>] [--full]` — pulls data from enabled sources and saves to SQLite.
 * Runs sources in parallel with live progress. Default first sync = 1 year back.
 * --full fetches everything (no date cutoff).
 */
import { loadConfig } from "@shared/config.ts";
import { upsertItems } from "@shared/db.ts";
import { FileSyncState } from "@daemon/sync-state.ts";
import type { Source, SyncOptions, SyncState } from "@daemon/sources/types.ts";

/** A SyncState that always returns 0 — forces sources to fetch everything. */
class FreshSyncState implements SyncState {
  private real: FileSyncState;
  constructor(real: FileSyncState) { this.real = real; }
  getLastSync(_source: string): number { return 0; }
  markSynced(source: string, highWaterMark?: number): void {
    this.real.markSynced(source, highWaterMark);
  }
}
import { imessage } from "@daemon/sources/imessage.ts";
import { signal } from "@daemon/sources/signal.ts";
import { granola } from "@daemon/sources/granola.ts";
import { gmail, gcal, gtasks, gdrive } from "@daemon/sources/gmail.ts";
import { github } from "@daemon/sources/github.ts";
import { chrome } from "@daemon/sources/chrome.ts";
import { appleNotes } from "@daemon/sources/apple-notes.ts";

const sourceRegistry: Record<string, Source> = {
  imessage,
  signal,
  granola,
  gmail,
  gcal,
  gtasks,
  gdrive,
  github,
  chrome,
  apple_notes: appleNotes,
};

interface SourceStatus {
  name: string;
  state: "pending" | "syncing" | "saving" | "done" | "error";
  items: number;
  progress: number; // items fetched so far (during syncing)
  timeMs: number;
  startMs: number;
  error?: string;
}

// Render state — all repaints go through a single coalesced timer
let _firstRender = true;
let _renderTimer: ReturnType<typeof setTimeout> | null = null;
let _spinnerFrame = 0;
let _spinnerInterval: ReturnType<typeof setInterval> | null = null;
const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

function repaint(statuses: SourceStatus[]): void {
  const maxName = Math.max(...statuses.map((s) => s.name.length));
  // Build the entire frame as one string to avoid interleaving
  let frame = `\x1b[${statuses.length}A`;
  for (const s of statuses) {
    frame += `\x1b[2K${formatLine(s, maxName)}\n`;
  }
  process.stdout.write(frame);
}

function renderProgress(statuses: SourceStatus[]): void {
  if (_firstRender) {
    _firstRender = false;
    process.stdout.write("\x1b[?25l");
    const maxName = Math.max(...statuses.map((s) => s.name.length));
    let frame = "";
    for (const s of statuses) {
      frame += `\x1b[2K${formatLine(s, maxName)}\n`;
    }
    process.stdout.write(frame);

    // Start spinner animation
    _spinnerInterval = setInterval(() => {
      _spinnerFrame++;
      repaint(statuses);
    }, 80);
    return;
  }

  // Coalesce all updates into a single repaint per frame
  if (!_renderTimer) {
    _renderTimer = setTimeout(() => {
      _renderTimer = null;
      repaint(statuses);
    }, 16);
  }
}

function flushRender(statuses: SourceStatus[]): void {
  if (_renderTimer) {
    clearTimeout(_renderTimer);
    _renderTimer = null;
  }
  if (!_firstRender) {
    repaint(statuses);
  }
}

function finishProgress(statuses: SourceStatus[]): void {
  if (_spinnerInterval) {
    clearInterval(_spinnerInterval);
    _spinnerInterval = null;
  }
  flushRender(statuses);
  process.stdout.write("\x1b[?25h");
  _firstRender = true;
}

function formatLine(s: SourceStatus, maxName: number): string {
  const name = s.name.padEnd(maxName);
  switch (s.state) {
    case "pending":
      return `  \x1b[90m${name}  waiting...\x1b[0m`;
    case "syncing": {
      const elapsed = s.startMs > 0 ? formatTime(performance.now() - s.startMs) : "";
      const progress = s.progress > 0 ? ` ${s.progress.toLocaleString()} items` : "";
      const time = elapsed ? ` \x1b[90m(${elapsed})\x1b[0m` : "";
      const frame = SPINNER_FRAMES[_spinnerFrame % SPINNER_FRAMES.length];
      return `  \x1b[33m${name}  ${frame}${progress || " syncing..."}${time}\x1b[0m`;
    }
    case "saving":
      return `  \x1b[33m${name}  ${s.items.toLocaleString()} items, saving...\x1b[0m`;
    case "done":
      if (s.items > 0) {
        return `  \x1b[32m${name}  ✓ ${s.items.toLocaleString()} items\x1b[0m \x1b[90m(${formatTime(s.timeMs)})\x1b[0m`;
      }
      return `  \x1b[90m${name}  ✓ 0 items (${formatTime(s.timeMs)})\x1b[0m`;
    case "error":
      return `  \x1b[31m${name}  ✗ ${s.error}\x1b[0m`;
  }
}

function formatTime(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

const SOURCE_TIMEOUT_MS = 2 * 60 * 1000; // 2 minutes per source

async function syncSource(
  source: Source,
  state: SyncState,
  status: SourceStatus,
  statuses: SourceStatus[],
  options: SyncOptions,
): Promise<void> {
  status.state = "syncing";
  status.startMs = performance.now();
  renderProgress(statuses);

  const start = performance.now();

  // Progress callback — update the status and re-render
  const syncOptions: SyncOptions = {
    ...options,
    onProgress: (count: number) => {
      status.progress = count;
      renderProgress(statuses);
    },
  };

  try {
    // Race the fetch against a timeout
    const items = await Promise.race([
      source.fetchNew(state, syncOptions),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("Timed out after 2 minutes")), SOURCE_TIMEOUT_MS)
      ),
    ]);

    if (items.length > 0) {
      status.state = "saving";
      status.items = items.length;
      renderProgress(statuses);

      const dbItems = items.map((item) => ({
        source: item.source,
        external_id: item.externalId,
        content: item.content,
        metadata: item.metadata,
        created_at: item.createdAt,
      }));
      upsertItems(dbItems);
    }

    status.state = "done";
    status.items = items.length;
    status.timeMs = performance.now() - start;
    state.markSynced(source.name);
  } catch (e) {
    status.state = "error";
    status.timeMs = performance.now() - start;
    status.error = e instanceof Error ? e.message.slice(0, 80) : String(e);
  }

  renderProgress(statuses);
}

export async function handleSync(args: string[]): Promise<void> {
  const sourceIdx = args.indexOf("--source");
  const sourceFilter = sourceIdx !== -1 ? args[sourceIdx + 1] : undefined;
  const isFull = args.includes("--full");

  const config = loadConfig();
  const fileState = new FileSyncState();
  // --full: ignore existing sync timestamps so sources fetch from the beginning
  const state: SyncState = isFull ? new FreshSyncState(fileState) : fileState;

  const options: SyncOptions = {
    defaultDays: isFull ? 0 : 365,
  };

  let sourcesToSync: Source[];

  if (sourceFilter) {
    const source = sourceRegistry[sourceFilter];
    if (!source) {
      const available = Object.keys(sourceRegistry).join(", ");
      console.error(`Unknown source: "${sourceFilter}". Available: ${available}`);
      process.exit(1);
    }
    sourcesToSync = [source];
  } else {
    sourcesToSync = [];
    for (const [key, source] of Object.entries(sourceRegistry)) {
      const configKey = key as keyof typeof config.sources;
      if (config.sources[configKey]) {
        sourcesToSync.push(source);
      }
    }

    if (sourcesToSync.length === 0) {
      console.log("No sources enabled. Run `kent init` to configure sources.");
      process.exit(0);
    }
  }

  console.log(`\n  Syncing ${sourcesToSync.length} source${sourcesToSync.length > 1 ? "s" : ""}${isFull ? " (full history)" : ""}...\n`);

  const statuses: SourceStatus[] = sourcesToSync.map((s) => ({
    name: s.name,
    state: "pending" as const,
    items: 0,
    progress: 0,
    timeMs: 0,
    startMs: 0,
  }));

  // Suppress console.warn/log from sources during parallel sync — they corrupt the progress display
  const origWarn = console.warn;
  const origLog = console.log;
  const suppressedWarnings: string[] = [];

  // Initial render
  renderProgress(statuses);

  // Mute console during parallel execution
  console.warn = (...args: any[]) => suppressedWarnings.push(args.join(" "));
  console.log = () => {};

  // Run all sources in parallel
  await Promise.all(
    sourcesToSync.map((source, i) =>
      syncSource(source, state, statuses[i]!, statuses, options)
    )
  );

  // Restore console and show cursor
  console.warn = origWarn;
  console.log = origLog;
  finishProgress(statuses);

  // Summary
  const total = statuses.reduce((sum, s) => sum + s.items, 0);
  const errors = statuses.filter((s) => s.state === "error").length;
  const elapsed = Math.max(...statuses.map((s) => s.timeMs));

  console.log("");
  if (errors > 0) {
    console.log(`  Done: ${total.toLocaleString()} items synced, ${errors} error${errors > 1 ? "s" : ""} (${formatTime(elapsed)})\n`);
  } else {
    console.log(`  Done: ${total.toLocaleString()} items synced (${formatTime(elapsed)})\n`);
  }

  process.exit(0);
}
