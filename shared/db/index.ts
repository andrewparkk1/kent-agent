/**
 * Local SQLite database — Kysely + bun:sqlite.
 * Re-exports all domain modules.
 */
export { getDb, getRawDb } from "./connection.ts";
export type { Database } from "./schema.ts";
export type { Item, DbItem } from "./items.ts";
export type { Thread, Message } from "./threads.ts";
export type { Workflow } from "./workflows.ts";
export type { Memory, MemoryType, MemoryLink } from "./memories.ts";

export { upsertItems, searchItems, getItemsBySource, getItemCount, getLatestItemTimestamp } from "./items.ts";
export { createThread, finishThread, getRecentThreads, getWorkflowRuns, getThread, addMessage, getMessages } from "./threads.ts";
export { createWorkflow, listWorkflows, getWorkflow, updateWorkflow, deleteWorkflow, archiveWorkflow, unarchiveWorkflow, getDueWorkflows } from "./workflows.ts";
export { createMemory, updateMemory, archiveMemory, getMemory, listMemories, searchMemories, deleteMemory, linkMemories, unlinkMemories, getLinkedMemories, getBacklinks, getAllLinks } from "./memories.ts";
