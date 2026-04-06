/** Memory tools — persistent wiki-style knowledge base across sessions. */
import { Type } from "@sinclair/typebox";
import type { AgentTool } from "@mariozechner/pi-agent-core";
import { createMemory, updateMemory, archiveMemory, listMemories, searchMemories, linkMemories, unlinkMemories, type MemoryType } from "@shared/db.ts";
import { ok, err, json } from "./helpers.ts";

export const memCreate: AgentTool<any> = {
  name: "create_memory",
  label: "Creating memory...",
  description: "Create a new wiki-style memory entry. Use for people, projects, topics, events, preferences, or places. Write rich, structured content with markdown sections.",
  parameters: Type.Object({
    type: Type.String({ description: "person, project, topic, event, preference, or place" }),
    title: Type.String({ description: "Short title (e.g. person's name, project name)" }),
    summary: Type.Optional(Type.String({ description: "1-2 sentence overview (like a Wikipedia opening paragraph)" })),
    body: Type.String({ description: "Rich markdown content with ## sections. Write like a wiki article — structured, detailed, cross-referenced." }),
    sources: Type.Optional(Type.Array(Type.String(), { description: "Data sources this came from" })),
    aliases: Type.Optional(Type.Array(Type.String(), { description: "Alternative names (nicknames, emails)" })),
  }),
  execute: async (_id, params) => {
    try {
      const id = await createMemory({ type: params.type as MemoryType, title: params.title, summary: params.summary, body: params.body, sources: params.sources, aliases: params.aliases });
      return ok(`Memory created: "${params.title}" (${params.type}, id: ${id})`);
    } catch (e) { return err(`Failed to create memory: ${e}`); }
  },
};

export const memUpdate: AgentTool<any> = {
  name: "update_memory",
  label: "Updating memory...",
  description: "Update an existing memory with new information. Can update summary, body (markdown sections), title, type, sources, or aliases.",
  parameters: Type.Object({
    id: Type.String({ description: "Memory ID to update" }),
    title: Type.Optional(Type.String()),
    summary: Type.Optional(Type.String({ description: "1-2 sentence overview" })),
    body: Type.Optional(Type.String({ description: "Full markdown body with ## sections" })),
    type: Type.Optional(Type.String()),
    sources: Type.Optional(Type.Array(Type.String())),
    aliases: Type.Optional(Type.Array(Type.String())),
  }),
  execute: async (_id, params) => {
    try { const { id, ...fields } = params; await updateMemory(id, fields as any); return ok(`Memory "${id}" updated.`); }
    catch (e) { return err(`Failed to update memory: ${e}`); }
  },
};

export const memArchive: AgentTool<any> = {
  name: "archive_memory",
  label: "Archiving memory...",
  description: "Archive a stale memory (30+ days no activity, completed project, past event).",
  parameters: Type.Object({ id: Type.String({ description: "Memory ID" }) }),
  execute: async (_id, params) => {
    try { await archiveMemory(params.id); return ok(`Memory "${params.id}" archived.`); }
    catch (e) { return err(`Failed to archive memory: ${e}`); }
  },
};

export const memList: AgentTool<any> = {
  name: "list_memories",
  label: "Listing memories...",
  description: "List all active memories, optionally filtered by type.",
  parameters: Type.Object({ type: Type.Optional(Type.String({ description: "Filter by type" })) }),
  execute: async (_id, params) => {
    try {
      const memories = await listMemories({ type: params.type as MemoryType | undefined });
      if (memories.length === 0) return ok("No memories yet.");
      const now = Math.floor(Date.now() / 1000);
      return json(memories.map((m) => {
        const daysSinceUpdate = Math.floor((now - m.updated_at) / 86400);
        return {
          id: m.id, type: m.type, title: m.title, summary: m.summary, body: m.body,
          aliases: JSON.parse(m.aliases), updated: new Date(m.updated_at * 1000).toISOString(),
          days_since_update: daysSinceUpdate,
          stale: daysSinceUpdate >= 30,
        };
      }));
    } catch (e) { return err(`Failed to list memories: ${e}`); }
  },
};

export const memSearch: AgentTool<any> = {
  name: "search_memories",
  label: "Searching memories...",
  description: "Search memories by keyword across titles, summaries, bodies, and aliases.",
  parameters: Type.Object({ query: Type.String({ description: "Search term" }) }),
  execute: async (_id, params) => {
    try {
      const results = await searchMemories(params.query);
      if (results.length === 0) return ok("No matching memories found.");
      return json(results.map((m) => ({ id: m.id, type: m.type, title: m.title, summary: m.summary, body: m.body, aliases: JSON.parse(m.aliases) })));
    } catch (e) { return err(`Failed to search memories: ${e}`); }
  },
};

export const memLink: AgentTool<any> = {
  name: "link_memories",
  label: "Linking memories...",
  description: "Create a wiki-style link between two memories. Links are directional (from → to) and can have an optional label describing the relationship.",
  parameters: Type.Object({
    from_id: Type.String({ description: "Source memory ID" }),
    to_id: Type.String({ description: "Target memory ID" }),
    label: Type.Optional(Type.String({ description: "Relationship label (e.g. 'works on', 'related to', 'part of')" })),
  }),
  execute: async (_id, params) => {
    try {
      await linkMemories(params.from_id, params.to_id, params.label ?? "");
      return ok(`Linked ${params.from_id} → ${params.to_id}${params.label ? ` (${params.label})` : ""}`);
    } catch (e) { return err(`Failed to link memories: ${e}`); }
  },
};

export const memUnlink: AgentTool<any> = {
  name: "unlink_memories",
  label: "Unlinking memories...",
  description: "Remove a link between two memories.",
  parameters: Type.Object({
    from_id: Type.String({ description: "Source memory ID" }),
    to_id: Type.String({ description: "Target memory ID" }),
  }),
  execute: async (_id, params) => {
    try {
      await unlinkMemories(params.from_id, params.to_id);
      return ok(`Unlinked ${params.from_id} → ${params.to_id}`);
    } catch (e) { return err(`Failed to unlink memories: ${e}`); }
  },
};

export const memoryTools = [memCreate, memUpdate, memArchive, memList, memSearch, memLink, memUnlink] as AgentTool[];
