/** Kent API server — routes requests to handler modules + serves static frontend. */
import { resolve, join, extname } from "node:path";
import { existsSync } from "node:fs";
import { handleCounts, handleItems } from "./api/items.ts";
import { handleWorkflows, handleWorkflowDetail, handleWorkflowRun, handleWorkflowToggle, handleWorkflowArchive, handleWorkflowUnarchive, handleWorkflowDelete, handleActivity, handleActivitySeen, handleUnreadCount, handleBrief } from "./api/workflows.ts";
import { handleSources, handleDaemonState, handleDaemonStart, handleDaemonStop, handleDaemonSync, handleDaemonRestart } from "./api/sources.ts";
import { handleMemories, handleMemoryDetail, handleMemoryIndex, handleMemoryArchive, handleMemoryUpdate } from "./api/memories.ts";
import { handleIdentity, handleIdentitySave } from "./api/identity.ts";
import { handleThreads, handleThreadMessages, handleDeleteThread } from "./api/threads.ts";
import { handleChat } from "./api/chat.ts";
import { handleSync } from "./api/sync.ts";
import { handleSettings, handleSettingsSave } from "./api/settings.ts";
import { handleTools } from "./api/tools.ts";
import { handleFeedback } from "./api/feedback.ts";
import { handleOllamaModels } from "./api/ollama.ts";
import {
  handleSetupStatus,
  handleSetupInit,
  handleSetupCheckFDA,
  handleSetupHardware,
  handleSetupCheckSources,
  handleSetupOllamaStatus,
  handleSetupOllamaInstall,
  handleSetupOllamaPull,
  handleSetupOAuthGmail,
  handleSetupOAuthGithub,
  handleSetupSaveConfig,
  handleSetupSync,
  handleSetupStartServices,
  handleSetupOpenPermissions,
} from "./api/setup.ts";
import { API_PORT } from "../shared/config.ts";

const STATIC_DIR = process.env.KENT_STATIC_DIR || resolve(import.meta.dir, "dist-bundle");

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

// Build a stable version+identity blob at startup so Tauri (and any other
// shell) can distinguish "Kent's kent-server" from "some other process
// squatting on port 19456". KENT_BUILD_ID is written by build-dmg.sh at
// compile time; in dev we just tag it "dev".
const SERVER_IDENTITY = {
  app: "kent-server",
  buildId: process.env.KENT_BUILD_ID || "dev",
  staticDir: STATIC_DIR,
  staticExists: existsSync(STATIC_DIR),
  startedAt: Date.now(),
};

function handleHealth() {
  return Response.json({ ok: true, ...SERVER_IDENTITY });
}

Bun.serve({
  port: API_PORT,
  idleTimeout: 255, // max allowed by Bun — sync can take a while
  routes: {
    "/api/health":       { GET: handleHealth },
    "/api/counts":       handleCounts,
    "/api/items":        handleItems,
    "/api/workflows":    handleWorkflows,
    "/api/workflow":     handleWorkflowDetail,
    "/api/activity":     handleActivity,
    "/api/activity/unread": handleUnreadCount,
    "/api/brief":        handleBrief,
    "/api/sources":      handleSources,
    "/api/memories":     handleMemories,
    "/api/memories/index": handleMemoryIndex,
    "/api/threads":      handleThreads,
    "/api/threads/:id/messages": handleThreadMessages,
    "/api/identity":     handleIdentity,
    "/api/tools":        handleTools,
    "/api/daemon-state": handleDaemonState,
    "/api/daemon/start": { POST: handleDaemonStart },
    "/api/daemon/stop":  { POST: handleDaemonStop },
    "/api/daemon/restart": { POST: handleDaemonRestart },
    "/api/daemon/sync":  { POST: handleDaemonSync },
    "/api/setup/status":   { GET: handleSetupStatus },
    "/api/setup/hardware": { GET: handleSetupHardware },
    "/api/settings": {
      GET: handleSettings,
      POST: handleSettingsSave,
    },
    "/api/feedback": {
      POST: handleFeedback,
    },
  },

  async fetch(req) {
    const url = new URL(req.url);

    // GET /api/memories/index — memory title index for wiki link resolution
    if (url.pathname === "/api/memories/index" && req.method === "GET") {
      return handleMemoryIndex(req);
    }

    // POST /api/memories/:id/archive — archive a memory
    if (url.pathname.match(/^\/api\/memories\/[^/]+\/archive$/) && req.method === "POST") {
      return handleMemoryArchive(req);
    }

    // PUT /api/memories/:id — update a memory
    if (url.pathname.match(/^\/api\/memories\/[^/]+$/) && req.method === "PUT") {
      return handleMemoryUpdate(req);
    }

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

    if (url.pathname === "/api/ollama/models" && req.method === "GET") {
      return handleOllamaModels(req);
    }

    if (url.pathname === "/api/sync" && req.method === "POST") {
      return handleSync(req);
    }

    // Setup endpoints
    if (url.pathname === "/api/setup/init" && req.method === "POST") {
      return handleSetupInit();
    }
    if (url.pathname === "/api/setup/check-fda" && req.method === "GET") {
      return handleSetupCheckFDA();
    }
    if (url.pathname === "/api/setup/check-sources" && req.method === "GET") {
      return handleSetupCheckSources();
    }
    if (url.pathname === "/api/setup/ollama/status" && req.method === "GET") {
      return handleSetupOllamaStatus();
    }
    if (url.pathname === "/api/setup/ollama/install" && req.method === "POST") {
      return handleSetupOllamaInstall();
    }
    if (url.pathname === "/api/setup/ollama/pull" && req.method === "POST") {
      return handleSetupOllamaPull(req);
    }
    if (url.pathname === "/api/setup/oauth/gmail" && req.method === "POST") {
      return handleSetupOAuthGmail();
    }
    if (url.pathname === "/api/setup/oauth/github" && req.method === "POST") {
      return handleSetupOAuthGithub();
    }
    if (url.pathname === "/api/setup/save-config" && req.method === "POST") {
      return handleSetupSaveConfig(req);
    }
    if (url.pathname === "/api/setup/sync" && req.method === "POST") {
      return handleSetupSync();
    }
    if (url.pathname === "/api/setup/open-permissions" && req.method === "POST") {
      return handleSetupOpenPermissions();
    }
    if (url.pathname === "/api/setup/start-services" && req.method === "POST") {
      return handleSetupStartServices();
    }

    // Serve static frontend from dist-bundle (pre-built Vite output)
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

    // Static dir missing (or file not found) and this looks like a page load.
    // Serve a self-healing fallback so the user sees *something* instead of
    // a bare "Not Found". Tauri's webview normally bypasses this when the
    // real frontend is bundled, but if we're here it means the bundled
    // resources are missing — usually because a stale kent-server from a
    // previous Kent.app install is still running and its KENT_STATIC_DIR
    // points at a path that no longer exists on disk.
    const ext = extname(url.pathname);
    if (!ext || ext === ".html" || url.pathname === "/") {
      const staticMissing = !existsSync(STATIC_DIR);
      const html = `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>Kent — starting up</title>
  <style>
    html,body { margin:0; padding:0; height:100%; font-family:-apple-system, system-ui, sans-serif; background:#0e1012; color:#ddd; }
    .wrap { display:flex; align-items:center; justify-content:center; height:100vh; padding:24px; text-align:center; }
    .card { max-width:480px; }
    h2 { font-weight:500; margin:0 0 12px; color:#fff; }
    p { margin:8px 0; line-height:1.6; color:#888; font-size:13px; }
    code { font-family:'SF Mono',Menlo,monospace; font-size:11px; background:#1a1d21; padding:2px 6px; border-radius:4px; color:#aaa; }
    .dot { display:inline-block; width:8px; height:8px; border-radius:50%; background:#3b82f6; margin-right:8px; animation:pulse 1.5s infinite; }
    @keyframes pulse { 0%,100% { opacity:1; } 50% { opacity:.35; } }
    button { background:#1a1d21; color:#ddd; border:1px solid #2a2d31; padding:8px 16px; border-radius:6px; font-size:13px; cursor:pointer; margin-top:16px; }
    button:hover { background:#22252a; }
  </style>
</head>
<body>
  <div class="wrap">
    <div class="card">
      <h2><span class="dot"></span>Kent is starting up…</h2>
      <p>${staticMissing
        ? "A stale kent-server is running on port 19456 with a bundled frontend path that no longer exists. This usually means an older Kent.app install was replaced while running."
        : "Waiting for the frontend to become ready."}</p>
      <p>Build: <code>${SERVER_IDENTITY.buildId}</code> · Static: <code>${staticMissing ? "MISSING" : "ok"}</code></p>
      ${staticMissing
        ? `<p style="margin-top:16px">Fix: quit Kent, run <code>./scripts/uninstall.sh</code> in terminal to kill lingering processes, then reopen.</p>`
        : `<button onclick="location.reload()">Retry</button>`}
    </div>
  </div>
  <script>
    // Auto-retry every 2s in case the server recovers on its own.
    setTimeout(() => location.reload(), 2000);
  </script>
</body>
</html>`;
      return new Response(html, {
        status: 200,
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    }

    return new Response("Not Found", { status: 404 });
  },
});

console.log(`Kent API server running at http://localhost:${API_PORT}`);
