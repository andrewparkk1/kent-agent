/** Kent API server — routes requests to handler modules. */
import { handleCounts, handleItems } from "./api/items.ts";
import { handleWorkflows, handleWorkflowDetail, handleWorkflowRun, handleWorkflowToggle, handleWorkflowArchive, handleWorkflowUnarchive, handleWorkflowDelete, handleActivity, handleBrief } from "./api/workflows.ts";
import { handleSources, handleDaemonState } from "./api/sources.ts";
import { handleMemories } from "./api/memories.ts";
import { handleIdentity, handleIdentitySave } from "./api/identity.ts";
import { handleThreads, handleThreadMessages, handleDeleteThread } from "./api/threads.ts";
import { handleChat } from "./api/chat.ts";
import { handleSync } from "./api/sync.ts";
import { handleSettings, handleSettingsSave } from "./api/settings.ts";

Bun.serve({
  port: 3456,
  routes: {
    "/api/counts":       handleCounts,
    "/api/items":        handleItems,
    "/api/workflows":    handleWorkflows,
    "/api/workflow":     handleWorkflowDetail,
    "/api/activity":     handleActivity,
    "/api/brief":        handleBrief,
    "/api/sources":      handleSources,
    "/api/memories":     handleMemories,
    "/api/threads":      handleThreads,
    "/api/threads/:id/messages": handleThreadMessages,
    "/api/identity":     handleIdentity,
    "/api/daemon-state": handleDaemonState,
    "/api/settings":     handleSettings,
  },

  async fetch(req) {
    const url = new URL(req.url);

    // GET /api/threads/:id/messages
    if (url.pathname.match(/^\/api\/threads\/[^/]+\/messages$/) && req.method === "GET") {
      return handleThreadMessages(req);
    }

    // DELETE /api/threads/:id
    if (url.pathname.match(/^\/api\/threads\/[^/]+$/) && req.method === "DELETE") {
      return handleDeleteThread(req);
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

    if (url.pathname === "/api/settings" && req.method === "POST") {
      return handleSettingsSave(req);
    }

    if (url.pathname === "/api/sync" && req.method === "POST") {
      return handleSync(req);
    }

    return new Response("Not Found", { status: 404 });
  },
});

console.log("Kent API server running at http://localhost:3456");
