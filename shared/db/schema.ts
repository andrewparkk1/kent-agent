/** Database table types for Kysely. */
import type { Generated, Insertable, Selectable, Updateable } from "kysely";

// ─── Items ──────────────────────────────────────────────────────────────────

export interface ItemsTable {
  id: Generated<number>;
  source: string;
  external_id: string;
  content: string;
  metadata: string; // JSON
  created_at: number;
  synced_at: Generated<number>;
}

export type Item = Selectable<ItemsTable>;
export type NewItem = Insertable<ItemsTable>;

// ─── Threads ────────────────────────────────────────────────────────────────

export interface ThreadsTable {
  id: string;
  title: string | null;
  type: "chat" | "workflow";
  workflow_id: string | null;
  status: "running" | "done" | "error" | null;
  started_at: number | null;
  finished_at: number | null;
  created_at: Generated<number>;
  last_message_at: Generated<number>;
}

export type Thread = Selectable<ThreadsTable>;
export type NewThread = Insertable<ThreadsTable>;

// ─── Messages ───────────────────────────────────────────────────────────────

export interface MessagesTable {
  id: Generated<number>;
  thread_id: string;
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  metadata: string | null;
  created_at: Generated<number>;
}

export type Message = Selectable<MessagesTable>;
export type NewMessage = Insertable<MessagesTable>;

// ─── Workflows ──────────────────────────────────────────────────────────────

export interface WorkflowsTable {
  id: string;
  name: string;
  description: string;
  prompt: string;
  cron_schedule: string | null;
  type: "cron" | "manual" | "event";
  source: "default" | "user" | "suggested";
  enabled: Generated<number>;
  is_archived: Generated<number>;
  last_run_at: number | null;
  next_run_at: number | null;
  created_at: Generated<number>;
  updated_at: Generated<number>;
}

export type Workflow = Selectable<WorkflowsTable>;
export type NewWorkflow = Insertable<WorkflowsTable>;
export type WorkflowUpdate = Updateable<WorkflowsTable>;

// ─── Memories ───────────────────────────────────────────────────────────────

export interface MemoriesTable {
  id: string;
  type: "person" | "project" | "topic" | "event" | "preference" | "place";
  title: string;
  body: string;
  sources: string; // JSON array
  aliases: string; // JSON array
  is_archived: Generated<number>;
  created_at: Generated<number>;
  updated_at: Generated<number>;
}

export type Memory = Selectable<MemoriesTable>;
export type NewMemory = Insertable<MemoriesTable>;
export type MemoryUpdate = Updateable<MemoriesTable>;

export type MemoryType = Memory["type"];

// ─── Database ───────────────────────────────────────────────────────────────

export interface Database {
  items: ItemsTable;
  threads: ThreadsTable;
  messages: MessagesTable;
  workflows: WorkflowsTable;
  memories: MemoriesTable;
}
