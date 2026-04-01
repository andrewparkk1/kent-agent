/** Memory tools — persistent knowledge base across sessions. */
import { Type } from "@sinclair/typebox";
import type { AgentTool } from "@mariozechner/pi-agent-core";
import { createMemory, updateMemory, archiveMemory, listMemories, searchMemories, type MemoryType } from "@shared/db.ts";
import { ok, err, json } from "./helpers.ts";

export const memCreate: AgentTool<any> = {
  name: "create_memory",
  label: "Creating memory...",
  description: "Create a new memory entry. Use for people, projects, topics, events, preferences, or places.",
  parameters: Type.Object({
    type: Type.String({ description: "person, project, topic, event, preference, or place" }),
    title: Type.String({ description: "Short title (e.g. person's name, project name)" }),
    body: Type.String({ description: "2-5 sentences of useful context" }),
    sources: Type.Optional(Type.Array(Type.String(), { description: "Data sources this came from" })),
    aliases: Type.Optional(Type.Array(Type.String(), { description: "Alternative names (nicknames, emails)" })),
  }),
  execute: async (_id, params) => {
    try {
      const id = createMemory({ type: params.type as MemoryType, title: params.title, body: params.body, sources: params.sources, aliases: params.aliases });
      return ok(`Memory created: "${params.title}" (${params.type}, id: ${id})`);
    } catch (e) { return err(`Failed to create memory: ${e}`); }
  },
};

export const memUpdate: AgentTool<any> = {
  name: "update_memory",
  label: "Updating memory...",
  description: "Update an existing memory with new information.",
  parameters: Type.Object({
    id: Type.String({ description: "Memory ID to update" }),
    title: Type.Optional(Type.String()),
    body: Type.Optional(Type.String()),
    type: Type.Optional(Type.String()),
    sources: Type.Optional(Type.Array(Type.String())),
    aliases: Type.Optional(Type.Array(Type.String())),
  }),
  execute: async (_id, params) => {
    try { const { id, ...fields } = params; updateMemory(id, fields as any); return ok(`Memory "${id}" updated.`); }
    catch (e) { return err(`Failed to update memory: ${e}`); }
  },
};

export const memArchive: AgentTool<any> = {
  name: "archive_memory",
  label: "Archiving memory...",
  description: "Archive a stale memory (30+ days no activity, completed project, past event).",
  parameters: Type.Object({ id: Type.String({ description: "Memory ID" }) }),
  execute: async (_id, params) => {
    try { archiveMemory(params.id); return ok(`Memory "${params.id}" archived.`); }
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
      const memories = listMemories({ type: params.type as MemoryType | undefined });
      if (memories.length === 0) return ok("No memories yet.");
      return json(memories.map((m) => ({
        id: m.id, type: m.type, title: m.title, body: m.body,
        aliases: JSON.parse(m.aliases), updated: new Date(m.updated_at * 1000).toISOString(),
      })));
    } catch (e) { return err(`Failed to list memories: ${e}`); }
  },
};

export const memSearch: AgentTool<any> = {
  name: "search_memories",
  label: "Searching memories...",
  description: "Search memories by keyword across titles, bodies, and aliases.",
  parameters: Type.Object({ query: Type.String({ description: "Search term" }) }),
  execute: async (_id, params) => {
    try {
      const results = searchMemories(params.query);
      if (results.length === 0) return ok("No matching memories found.");
      return json(results.map((m) => ({ id: m.id, type: m.type, title: m.title, body: m.body, aliases: JSON.parse(m.aliases) })));
    } catch (e) { return err(`Failed to search memories: ${e}`); }
  },
};

export const memoryTools = [memCreate, memUpdate, memArchive, memList, memSearch] as AgentTool[];
