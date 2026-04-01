/** Kent API server — routes requests to handler modules. */
import { handleCounts, handleItems } from "./api/items.ts";
import { handleWorkflows, handleWorkflowDetail, handleActivity } from "./api/workflows.ts";
import { handleSources, handleDaemonState } from "./api/sources.ts";
import { handleMemories } from "./api/memories.ts";
import { handleIdentity, handleIdentitySave } from "./api/identity.ts";
import { handleThreads, handleThreadMessages, handleDeleteThread } from "./api/threads.ts";
import { handleChat } from "./api/chat.ts";

Bun.serve({
  port: 3456,
  routes: {
    "/api/counts":       handleCounts,
    "/api/items":        handleItems,
    "/api/workflows":    handleWorkflows,
    "/api/workflow":     handleWorkflowDetail,
    "/api/activity":     handleActivity,
    "/api/sources":      handleSources,
    "/api/memories":     handleMemories,
    "/api/threads":      handleThreads,
    "/api/threads/:id/messages": handleThreadMessages,
    "/api/identity":     handleIdentity,
    "/api/daemon-state": handleDaemonState,
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

    if (url.pathname === "/api/identity" && req.method === "POST") {
      return handleIdentitySave(req);
    }

    if (url.pathname === "/api/chat" && req.method === "POST") {
      return handleChat(req);
    }

    return new Response("Not Found", { status: 404 });
  },
});

console.log("Kent API server running at http://localhost:3456");
