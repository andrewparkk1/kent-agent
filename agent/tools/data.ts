/** Data source tools — search/browse synced items. */
import { Type } from "@sinclair/typebox";
import type { AgentTool } from "@mariozechner/pi-agent-core";
import { searchItems, getItemsBySource, getItemCount, getRecentThreads, getMessages } from "@shared/db.ts";
import { json, err } from "./helpers.ts";

const Empty = Type.Object({});

export const searchData: AgentTool<any> = {
  name: "search_memory",
  label: "Searching memory...",
  description: "Search across all synced sources (iMessage, Gmail, GitHub, etc.) by keywords.",
  parameters: Type.Object({
    query: Type.String({ description: "Keywords to search for" }),
    source: Type.Optional(Type.String({ description: "Filter to a specific source" })),
    limit: Type.Optional(Type.Number({ description: "Max results (default 50)" })),
  }),
  execute: async (_id, params) => {
    try {
      return json(searchItems(params.query, params.limit ?? 50, params.source));
    } catch (e) {
      return err(`search_memory failed: ${e}`);
    }
  },
};

export const getRecent: AgentTool<any> = {
  name: "get_recent_items",
  label: "Getting recent items...",
  description: "Get the latest items from one or more sources, sorted by time.",
  parameters: Type.Object({
    source: Type.Optional(Type.String({ description: "Filter to a specific source" })),
    limit: Type.Optional(Type.Number({ description: "Max results (default 50)" })),
  }),
  execute: async (_id, params) => {
    try {
      if (params.source) {
        return json(await getItemsBySource(params.source, params.limit ?? 50));
      }
      const counts = await getItemCount();
      const all: any[] = [];
      for (const source of Object.keys(counts)) {
        all.push(...await getItemsBySource(source, params.limit ?? 10));
      }
      all.sort((a, b) => b.created_at - a.created_at);
      return json(all.slice(0, params.limit ?? 50));
    } catch (e) {
      return err(`get_recent_items failed: ${e}`);
    }
  },
};

export const getStats: AgentTool<any> = {
  name: "get_source_stats",
  label: "Getting source stats...",
  description: "Get item counts per source. Use to understand what data is available.",
  parameters: Empty,
  execute: async () => {
    try {
      return json(await getItemCount());
    } catch (e) {
      return err(`get_source_stats failed: ${e}`);
    }
  },
};

export const getThreads: AgentTool<any> = {
  name: "get_recent_threads",
  label: "Getting recent threads...",
  description: "Get recent conversation threads (chats and workflow runs). Use to review past conversations for context.",
  parameters: Type.Object({
    type: Type.Optional(Type.String({ description: "Filter by 'chat' or 'workflow'. Omit for all." })),
    limit: Type.Optional(Type.Number({ description: "Max threads (default 10)" })),
  }),
  execute: async (_id, params) => {
    try {
      const threads = await getRecentThreads(params.limit ?? 10, params.type as any);
      return json(threads.map((t) => ({
        id: t.id, title: t.title, type: t.type, status: t.status,
        created: new Date(t.created_at * 1000).toISOString(),
      })));
    } catch (e) {
      return err(`get_recent_threads failed: ${e}`);
    }
  },
};

export const getThreadMessages: AgentTool<any> = {
  name: "get_thread_messages",
  label: "Getting thread messages...",
  description: "Get all messages from a specific thread. Use to review past conversations for context about people, topics, or decisions.",
  parameters: Type.Object({
    thread_id: Type.String({ description: "Thread ID to load messages from" }),
    limit: Type.Optional(Type.Number({ description: "Max messages (default 200)" })),
  }),
  execute: async (_id, params) => {
    try {
      const msgs = await getMessages(params.thread_id, params.limit ?? 200);
      return json(msgs.map((m) => ({
        role: m.role, content: m.content,
        ...(m.metadata ? { metadata: JSON.parse(m.metadata) } : {}),
      })));
    } catch (e) {
      return err(`get_thread_messages failed: ${e}`);
    }
  },
};

export const dataTools = [searchData, getRecent, getStats, getThreads, getThreadMessages] as AgentTool[];
