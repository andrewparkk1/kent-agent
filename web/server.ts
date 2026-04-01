import { getItemCount, searchItems, getItemsBySource, getDb } from "../shared/db.ts";
import { loadConfig, DAEMON_STATE_PATH } from "../shared/config.ts";
import { readFileSync, existsSync } from "node:fs";

Bun.serve({
  port: 3456,
  routes: {
    "/api/counts": () => {
      return Response.json(getItemCount());
    },

    "/api/items": (req) => {
      const url = new URL(req.url);
      const source = url.searchParams.get("source");
      const q = url.searchParams.get("q");
      const limit = Math.min(Number(url.searchParams.get("limit") || 200), 500);

      let items;
      if (q) {
        items = searchItems(q, limit, source ?? undefined);
      } else if (source) {
        items = getItemsBySource(source, limit);
      } else {
        const rows = getDb()
          .prepare(`
            SELECT id, source, external_id, content, metadata, created_at
            FROM items
            ORDER BY created_at DESC
            LIMIT ?
          `)
          .all(limit) as any[];

        items = rows.map((r: any) => ({
          ...r,
          metadata: JSON.parse(r.metadata),
        }));
      }

      return Response.json({ items });
    },

    "/api/workflows": () => {
      const db = getDb();
      const workflows = db
        .prepare(`SELECT * FROM workflows ORDER BY updated_at DESC`)
        .all() as any[];

      const runs = db
        .prepare(
          `SELECT workflow_id, COUNT(*) as run_count,
                  MAX(started_at) as last_run_at,
                  SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed_count
           FROM workflow_runs GROUP BY workflow_id`
        )
        .all() as any[];

      const runMap: Record<string, any> = {};
      for (const r of runs) runMap[r.workflow_id] = r;

      return Response.json({
        workflows: workflows.map((w: any) => ({
          ...w,
          enabled: !!w.enabled,
          runCount: runMap[w.id]?.run_count || 0,
          lastRunAt: w.last_run_at || runMap[w.id]?.last_run_at || null,
        })),
      });
    },

    "/api/sources": () => {
      const config = loadConfig();
      const counts = getItemCount();

      // Read daemon state for live status
      let daemonState: any = { status: "stopped", enabledSources: [] };
      if (existsSync(DAEMON_STATE_PATH)) {
        try {
          daemonState = JSON.parse(readFileSync(DAEMON_STATE_PATH, "utf-8"));
        } catch {}
      }

      const sources = Object.entries(config.sources).map(([key, enabled]) => {
        // Normalize key: config uses underscores, DB/daemon uses hyphens
        const dbKey = key.replace("_", "-");
        return {
          id: key,
          enabled: !!enabled,
          itemCount: counts[key] || counts[dbKey] || 0,
          syncing: daemonState.currentSource === key || daemonState.currentSource === dbKey,
        };
      });

      return Response.json({
        sources,
        daemon: {
          status: daemonState.status || "stopped",
          currentSource: daemonState.currentSource || null,
          intervalMinutes: daemonState.intervalMinutes || config.daemon.sync_interval_minutes,
        },
      });
    },

    "/api/activity": () => {
      const db = getDb();
      const runs = db
        .prepare(
          `SELECT r.*, w.name as workflow_name
           FROM workflow_runs r
           LEFT JOIN workflows w ON w.id = r.workflow_id
           ORDER BY r.started_at DESC
           LIMIT 100`
        )
        .all() as any[];

      return Response.json({ runs });
    },

    "/api/daemon-state": () => {
      try {
        const raw = readFileSync(DAEMON_STATE_PATH, "utf-8");
        return Response.json(JSON.parse(raw));
      } catch {
        return Response.json({ status: "stopped" });
      }
    },
  },

  fetch() {
    return new Response("Not Found", { status: 404 });
  },
});

console.log("Kent API server running at http://localhost:3456");
