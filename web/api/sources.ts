/** GET /api/sources — source config + daemon status. */
/** GET /api/daemon-state — raw daemon state JSON. */
/** POST /api/daemon/start — start the daemon via launchd. */
/** POST /api/daemon/stop — stop the daemon. */
import { getItemCount } from "../../shared/db.ts";
import { loadConfig, DAEMON_STATE_PATH, PID_PATH } from "../../shared/config.ts";
import { readFileSync, existsSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { daemonStart, daemonStop } from "../../cli/commands/daemon.ts";

/**
 * Spawn the bundled kent-daemon binary directly. Used when Tauri has set
 * KENT_DAEMON_BIN — in that case we can't go through the TS CLI daemonStart
 * (which generates a launchd plist pointing at a `bun run daemon.ts` command
 * that doesn't exist inside the DMG).
 */
function spawnBundledDaemon(daemonBin: string): boolean {
  // Already running? Trust the PID file if the process is alive.
  if (existsSync(PID_PATH)) {
    try {
      const pid = Number(readFileSync(PID_PATH, "utf-8").trim());
      process.kill(pid, 0);
      return true; // already alive
    } catch {
      // Stale PID file — fall through and respawn.
    }
  }

  const proc = Bun.spawn([daemonBin], {
    stdout: "ignore",
    stderr: "ignore",
    stdin: "ignore",
    env: {
      ...process.env as Record<string, string>,
      KENT_AGENT_BIN: process.env.KENT_AGENT_BIN || "",
    },
  });
  proc.unref();

  // Write a PID file so isDaemonRunning() reflects this launch immediately.
  // The daemon itself also writes one but we beat it to the punch for snappy UI.
  try {
    writeFileSync(PID_PATH, String(proc.pid), "utf-8");
  } catch {}
  return true;
}

function isDaemonRunning(): boolean {
  if (!existsSync(PID_PATH)) return false;
  try {
    const pid = Number(readFileSync(PID_PATH, "utf-8").trim());
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export async function handleSources() {
  const config = loadConfig();
  const counts = await getItemCount();
  const running = isDaemonRunning();

  let daemonState: any = { status: "stopped", enabledSources: [] };
  if (existsSync(DAEMON_STATE_PATH)) {
    try {
      daemonState = JSON.parse(readFileSync(DAEMON_STATE_PATH, "utf-8"));
    } catch {}
  }

  let status = "stopped";
  if (running) {
    status = daemonState.status || "running";
  }

  const sources = Object.entries(config.sources).map(([key, enabled]) => {
    const dbKey = key.replace("_", "-");
    return {
      id: key,
      enabled: !!enabled,
      itemCount: counts[key] || counts[dbKey] || 0,
      syncing: running && (daemonState.currentSource === key || daemonState.currentSource === dbKey),
      lastError: daemonState.lastSyncErrors?.[key] || daemonState.lastSyncErrors?.[dbKey] || null,
      lastSyncItemCount: daemonState.lastSyncResults?.[key] ?? daemonState.lastSyncResults?.[dbKey] ?? null,
    };
  });

  return Response.json({
    sources,
    daemon: {
      status,
      currentSource: running ? (daemonState.currentSource || null) : null,
      intervalSeconds: daemonState.intervalSeconds || config.daemon.sync_interval_seconds,
      lastSyncAt: daemonState.lastSyncAt || null,
      nextSyncAt: daemonState.nextSyncAt || null,
      lastSyncErrors: daemonState.lastSyncErrors || null,
    },
  });
}

export async function handleDaemonStart() {
  try {
    // Bundled DMG: spawn kent-daemon sidecar directly.
    // Dev mode: fall through to daemonStart() which uses the TS CLI + launchd plist.
    const daemonBin = process.env.KENT_DAEMON_BIN;
    if (daemonBin && existsSync(daemonBin)) {
      spawnBundledDaemon(daemonBin);
      return Response.json({ ok: true });
    }
    await daemonStart();
    return Response.json({ ok: true });
  } catch (e: any) {
    return Response.json({ ok: false, error: e.message }, { status: 500 });
  }
}

export async function handleDaemonStop() {
  try {
    // In bundled mode, kill the PID directly (no launchd plist to unload).
    if (process.env.KENT_DAEMON_BIN && existsSync(PID_PATH)) {
      try {
        const pid = Number(readFileSync(PID_PATH, "utf-8").trim());
        process.kill(pid, "SIGTERM");
      } catch {}
      try { require("node:fs").unlinkSync(PID_PATH); } catch {}
      return Response.json({ ok: true });
    }
    await daemonStop();
    return Response.json({ ok: true });
  } catch (e: any) {
    return Response.json({ ok: false, error: e.message }, { status: 500 });
  }
}

export async function handleDaemonRestart() {
  try {
    const daemonBin = process.env.KENT_DAEMON_BIN;
    if (daemonBin && existsSync(daemonBin)) {
      // Kill old PID, then spawn fresh.
      if (existsSync(PID_PATH)) {
        try {
          const pid = Number(readFileSync(PID_PATH, "utf-8").trim());
          process.kill(pid, "SIGTERM");
        } catch {}
        try { require("node:fs").unlinkSync(PID_PATH); } catch {}
      }
      await new Promise((r) => setTimeout(r, 300));
      spawnBundledDaemon(daemonBin);
      return Response.json({ ok: true });
    }
    try { await daemonStop(); } catch {}
    await new Promise((r) => setTimeout(r, 500));
    await daemonStart();
    return Response.json({ ok: true });
  } catch (e: any) {
    return Response.json({ ok: false, error: e.message }, { status: 500 });
  }
}

export async function handleDaemonSync() {
  try {
    const cliPath = resolve(import.meta.dir, "../../cli/index.ts");
    const proc = Bun.spawn(["bun", "run", cliPath, "sync"], {
      stdout: "ignore",
      stderr: "ignore",
      stdin: "ignore",
    });
    // Don't await — let it run in the background
    proc.unref();
    return Response.json({ ok: true });
  } catch (e: any) {
    return Response.json({ ok: false, error: e.message }, { status: 500 });
  }
}

export function handleDaemonState() {
  try {
    const raw = readFileSync(DAEMON_STATE_PATH, "utf-8");
    return Response.json(JSON.parse(raw));
  } catch {
    return Response.json({ status: "stopped" });
  }
}
