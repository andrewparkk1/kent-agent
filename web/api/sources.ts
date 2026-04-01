/** GET /api/sources — source config + daemon status. */
/** GET /api/daemon-state — raw daemon state JSON. */
import { getItemCount } from "../../shared/db.ts";
import { loadConfig, DAEMON_STATE_PATH, PID_PATH } from "../../shared/config.ts";
import { readFileSync, existsSync } from "node:fs";

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

export function handleSources() {
  const config = loadConfig();
  const counts = getItemCount();
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
    };
  });

  return Response.json({
    sources,
    daemon: {
      status,
      currentSource: running ? (daemonState.currentSource || null) : null,
      intervalMinutes: daemonState.intervalMinutes || config.daemon.sync_interval_minutes,
      lastSyncAt: daemonState.lastSyncAt || null,
      nextSyncAt: daemonState.nextSyncAt || null,
    },
  });
}

export function handleDaemonState() {
  try {
    const raw = readFileSync(DAEMON_STATE_PATH, "utf-8");
    return Response.json(JSON.parse(raw));
  } catch {
    return Response.json({ status: "stopped" });
  }
}
