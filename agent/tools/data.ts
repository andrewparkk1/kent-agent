/** Data source tools — search/browse synced items. */
import { Type } from "@sinclair/typebox";
import type { AgentTool } from "@mariozechner/pi-agent-core";
import { searchItems, getItemsBySource, getItemCount } from "@shared/db.ts";
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
        return json(getItemsBySource(params.source, params.limit ?? 50));
      }
      const counts = getItemCount();
      const all: any[] = [];
      for (const source of Object.keys(counts)) {
        all.push(...getItemsBySource(source, params.limit ?? 10));
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
      return json(getItemCount());
    } catch (e) {
      return err(`get_source_stats failed: ${e}`);
    }
  },
};

export const dataTools = [searchData, getRecent, getStats] as AgentTool[];
