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

Bun.serve({
  port: API_PORT,
  idleTimeout: 255, // max allowed by Bun — sync can take a while
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
