/**
 * Local SQLite database — all synced data and conversations live here (~/.kent/kent.db).
 * Re-exports all domain modules for backwards compatibility.
 */
export { getDb } from "./connection.ts";
export { upsertItems, searchItems, getItemsBySource, getItemCount } from "./items.ts";
export type { DbItem } from "./items.ts";
export { createThread, finishThread, getRecentThreads, getWorkflowRuns, getThread, addMessage, getMessages } from "./threads.ts";
export type { DbThread, DbMessage } from "./threads.ts";
export { createWorkflow, listWorkflows, getWorkflow, updateWorkflow, deleteWorkflow, archiveWorkflow, unarchiveWorkflow, getDueWorkflows } from "./workflows.ts";
export type { DbWorkflow } from "./workflows.ts";
export { createMemory, updateMemory, archiveMemory, getMemory, listMemories, searchMemories, deleteMemory } from "./memories.ts";
export type { DbMemory, MemoryType } from "./memories.ts";
