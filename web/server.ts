/** Kent API server — routes requests to handler modules + serves static frontend. */
import { resolve, join, extname } from "node:path";
import { existsSync } from "node:fs";
import { handleCounts, handleItems } from "./api/items.ts";
import { handleWorkflows, handleWorkflowDetail, handleWorkflowRun, handleWorkflowToggle, handleWorkflowArchive, handleWorkflowUnarchive, handleWorkflowDelete, handleActivity, handleActivitySeen, handleUnreadCount, handleBrief } from "./api/workflows.ts";
import { handleSources, handleDaemonState } from "./api/sources.ts";
import { handleMemories, handleMemoryDetail } from "./api/memories.ts";
import { handleIdentity, handleIdentitySave } from "./api/identity.ts";
import { handleThreads, handleThreadMessages, handleDeleteThread } from "./api/threads.ts";
import { handleChat } from "./api/chat.ts";
import { handleSync } from "./api/sync.ts";
import { handleSettings, handleSettingsSave } from "./api/settings.ts";
import { handleTools } from "./api/tools.ts";
import { API_PORT } from "../shared/config.ts";

const STATIC_DIR = process.env.KENT_STATIC_DIR || resolve(import.meta.dir, "dist");

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".webp": "image/webp",
  ".webm": "video/webm",
  ".mp4": "video/mp4",
  ".txt": "text/plain; charset=utf-8",
};

Bun.serve({
  port: API_PORT,
  routes: {
    "/api/counts":       handleCounts,
    "/api/items":        handleItems,
    "/api/workflows":    handleWorkflows,
    "/api/workflow":     handleWorkflowDetail,
    "/api/activity":     handleActivity,
    "/api/activity/unread": handleUnreadCount,
    "/api/brief":        handleBrief,
    "/api/sources":      handleSources,
    "/api/memories":     handleMemories,
    "/api/threads":      handleThreads,
    "/api/threads/:id/messages": handleThreadMessages,
    "/api/identity":     handleIdentity,
    "/api/tools":        handleTools,
    "/api/daemon-state": handleDaemonState,
    "/api/settings": {
      GET: handleSettings,
      POST: handleSettingsSave,
    },
  },

  async fetch(req) {
    const url = new URL(req.url);

    // GET /api/memories/:id — single memory with links
    if (url.pathname.match(/^\/api\/memories\/[^/]+$/) && req.method === "GET") {
      return handleMemoryDetail(req);
    }

    // GET /api/threads/:id/messages
    if (url.pathname.match(/^\/api\/threads\/[^/]+\/messages$/) && req.method === "GET") {
      return handleThreadMessages(req);
    }

    // DELETE /api/threads/:id
    if (url.pathname.match(/^\/api\/threads\/[^/]+$/) && req.method === "DELETE") {
      return handleDeleteThread(req);
    }

    if (url.pathname === "/api/activity/seen" && req.method === "POST") {
      return handleActivitySeen();
    }

    if (url.pathname === "/api/workflow/run" && req.method === "POST") {
      return handleWorkflowRun(req);
    }

    if (url.pathname === "/api/workflow/toggle" && req.method === "POST") {
      return handleWorkflowToggle(req);
    }

    if (url.pathname === "/api/workflow/delete" && req.method === "POST") {
      return handleWorkflowDelete(req);
    }

    if (url.pathname === "/api/workflow/archive" && req.method === "POST") {
      return handleWorkflowArchive(req);
    }

    if (url.pathname === "/api/workflow/unarchive" && req.method === "POST") {
      return handleWorkflowUnarchive(req);
    }

    if (url.pathname === "/api/identity" && req.method === "POST") {
      return handleIdentitySave(req);
    }

    if (url.pathname === "/api/chat" && req.method === "POST") {
      return handleChat(req);
    }

if (url.pathname === "/api/sync" && req.method === "POST") {
      return handleSync(req);
    }

    // Serve static frontend from web/dist/ (pre-built Vite output)
    if (existsSync(STATIC_DIR)) {
      const requestPath = url.pathname === "/" ? "index.html" : url.pathname;
      const filePath = join(STATIC_DIR, requestPath);
      const file = Bun.file(filePath);
      if (await file.exists()) {
        const ext = extname(filePath);
        const headers: Record<string, string> = {};
        if (MIME_TYPES[ext]) headers["Content-Type"] = MIME_TYPES[ext];
        return new Response(file, { headers });
      }
      // SPA fallback — serve index.html for client-side routes
      const ext = extname(url.pathname);
      if (!ext || ext === ".html") {
        const index = Bun.file(join(STATIC_DIR, "index.html"));
        if (await index.exists()) {
          return new Response(index, { headers: { "Content-Type": "text/html; charset=utf-8" } });
        }
      }
    }

    return new Response("Not Found", { status: 404 });
  },
});

console.log(`Kent API server running at http://localhost:${API_PORT}`);
