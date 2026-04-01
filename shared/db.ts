/**
 * Local SQLite database — all synced data and conversations live here (~/.kent/kent.db).
 * - items: synced data from all sources (iMessage, Gmail, GitHub, etc.) with FTS5 full-text search
 * - threads: conversation threads with the agent
 * - messages: individual messages within threads (user, assistant, system)
 * FTS5 index auto-syncs via triggers on insert/update/delete.
 */
import { Database } from "bun:sqlite";
import { join } from "node:path";
import { KENT_DIR, ensureKentDir } from "./config.ts";

const DB_PATH = join(KENT_DIR, "kent.db");

let _db: Database | null = null;

export function getDb(): Database {
  if (_db) return _db;

  ensureKentDir();
  _db = new Database(DB_PATH);
  _db.exec("PRAGMA journal_mode = WAL");
  _db.exec("PRAGMA foreign_keys = ON");

  initSchema(_db);
  runMigrations(_db);
  rebuildFtsIndex(_db);
  return _db;
}

/** Rebuild the FTS index from scratch (needed once for pre-existing data). */
function rebuildFtsIndex(db: Database): void {
  const count = (db.prepare("SELECT COUNT(*) as n FROM items").get() as any)?.n ?? 0;
  if (count === 0) return;

  const ftsCount = (db.prepare("SELECT COUNT(*) as n FROM items_fts").get() as any)?.n ?? 0;
  if (ftsCount > 0) return;

  db.exec("INSERT INTO items_fts(rowid, content, source, external_id) SELECT id, content, source, external_id FROM items");
}

function runMigrations(db: Database): void {
  const cols = db.prepare("PRAGMA table_info(workflows)").all() as any[];
  const colNames = cols.map((c: any) => c.name);
  if (cols.length > 0 && !colNames.includes("type")) {
    db.exec("ALTER TABLE workflows ADD COLUMN type TEXT NOT NULL DEFAULT 'cron'");
  }
  if (cols.length > 0 && !colNames.includes("source")) {
    db.exec("ALTER TABLE workflows ADD COLUMN source TEXT NOT NULL DEFAULT 'user'");
  }
}

function initSchema(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source TEXT NOT NULL,
      external_id TEXT NOT NULL,
      content TEXT NOT NULL,
      metadata TEXT NOT NULL DEFAULT '{}',
      created_at INTEGER NOT NULL,
      synced_at INTEGER NOT NULL DEFAULT (unixepoch()),
      UNIQUE(source, external_id)
    );

    CREATE INDEX IF NOT EXISTS idx_items_source ON items(source);
    CREATE INDEX IF NOT EXISTS idx_items_created_at ON items(created_at);
    CREATE INDEX IF NOT EXISTS idx_items_source_created ON items(source, created_at);

    CREATE VIRTUAL TABLE IF NOT EXISTS items_fts USING fts5(
      content,
      source UNINDEXED,
      external_id UNINDEXED,
      content=items,
      content_rowid=id,
      tokenize='porter unicode61'
    );

    -- Triggers to keep FTS index in sync with items table
    CREATE TRIGGER IF NOT EXISTS items_ai AFTER INSERT ON items BEGIN
      INSERT INTO items_fts(rowid, content, source, external_id)
      VALUES (new.id, new.content, new.source, new.external_id);
    END;

    CREATE TRIGGER IF NOT EXISTS items_ad AFTER DELETE ON items BEGIN
      INSERT INTO items_fts(items_fts, rowid, content, source, external_id)
      VALUES ('delete', old.id, old.content, old.source, old.external_id);
    END;

    CREATE TRIGGER IF NOT EXISTS items_au AFTER UPDATE ON items BEGIN
      INSERT INTO items_fts(items_fts, rowid, content, source, external_id)
      VALUES ('delete', old.id, old.content, old.source, old.external_id);
      INSERT INTO items_fts(rowid, content, source, external_id)
      VALUES (new.id, new.content, new.source, new.external_id);
    END;

    CREATE TABLE IF NOT EXISTS threads (
      id TEXT PRIMARY KEY,
      title TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      last_message_at INTEGER NOT NULL DEFAULT (unixepoch())
    );

    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      thread_id TEXT NOT NULL REFERENCES threads(id),
      role TEXT NOT NULL CHECK(role IN ('user', 'assistant', 'system')),
      content TEXT NOT NULL,
      created_at INTEGER NOT NULL DEFAULT (unixepoch())
    );

    CREATE INDEX IF NOT EXISTS idx_messages_thread ON messages(thread_id, created_at);

    CREATE TABLE IF NOT EXISTS workflows (
      id TEXT PRIMARY KEY,
      name TEXT UNIQUE NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      prompt TEXT NOT NULL,
      cron_schedule TEXT,
      type TEXT NOT NULL DEFAULT 'cron' CHECK(type IN ('cron', 'manual', 'event')),
      source TEXT NOT NULL DEFAULT 'user' CHECK(source IN ('default', 'user', 'suggested')),
      enabled INTEGER NOT NULL DEFAULT 1,
      last_run_at INTEGER,
      next_run_at INTEGER,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch())
    );

    CREATE TABLE IF NOT EXISTS workflow_runs (
      id TEXT PRIMARY KEY,
      workflow_id TEXT NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
      status TEXT NOT NULL CHECK(status IN ('pending', 'running', 'done', 'error')) DEFAULT 'pending',
      output TEXT,
      error TEXT,
      started_at INTEGER NOT NULL DEFAULT (unixepoch()),
      finished_at INTEGER
    );

    CREATE INDEX IF NOT EXISTS idx_workflow_runs_workflow ON workflow_runs(workflow_id, started_at);

    CREATE TABLE IF NOT EXISTS memories (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL CHECK(type IN ('person', 'project', 'topic', 'event', 'preference', 'place')),
      title TEXT NOT NULL,
      body TEXT NOT NULL DEFAULT '',
      sources TEXT NOT NULL DEFAULT '[]',
      aliases TEXT NOT NULL DEFAULT '[]',
      is_archived INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch())
    );

    CREATE INDEX IF NOT EXISTS idx_memories_type ON memories(type);
    CREATE INDEX IF NOT EXISTS idx_memories_archived ON memories(is_archived);
  `);
}

// ─── Items ───────────────────────────────────────────────────────────────────

export interface DbItem {
  source: string;
  external_id: string;
  content: string;
  metadata: Record<string, any>;
  created_at: number;
}

const _upsertItem = () => getDb().prepare(`
  INSERT INTO items (source, external_id, content, metadata, created_at)
  VALUES ($source, $external_id, $content, $metadata, $created_at)
  ON CONFLICT(source, external_id) DO UPDATE SET
    content = excluded.content,
    metadata = excluded.metadata,
    synced_at = CASE
      WHEN items.content != excluded.content OR items.metadata != excluded.metadata
      THEN unixepoch()
      ELSE items.synced_at
    END
`);

let upsertStmt: ReturnType<typeof _upsertItem> | null = null;

export function upsertItems(items: DbItem[]): number {
  const db = getDb();
  if (!upsertStmt) upsertStmt = _upsertItem();

  let count = 0;
  const tx = db.transaction(() => {
    for (const item of items) {
      upsertStmt!.run({
        $source: item.source,
        $external_id: item.external_id,
        $content: item.content,
        $metadata: JSON.stringify(item.metadata),
        $created_at: item.created_at,
      });
      count++;
    }
  });
  tx();
  return count;
}

export function searchItems(query: string, limit = 50, source?: string): Array<DbItem & { id: number; rank: number }> {
  // Escape FTS5 special chars and build a prefix query so partial words match
  const sanitized = query.replace(/['"()*:^~]/g, " ").trim();
  if (!sanitized) return [];

  const ftsQuery = sanitized
    .split(/\s+/)
    .map((word) => `"${word}"*`)
    .join(" ");

  const sourceFilter = source ? "AND i.source = $source" : "";

  const rows = getDb()
    .prepare(`
      SELECT i.id, i.source, i.external_id, i.content, i.metadata, i.created_at, f.rank
      FROM items_fts f
      JOIN items i ON i.id = f.rowid
      WHERE items_fts MATCH $query ${sourceFilter}
      ORDER BY f.rank
      LIMIT $limit
    `)
    .all({ $query: ftsQuery, $limit: limit, ...(source ? { $source: source } : {}) }) as any[];

  return rows.map((r) => ({
    ...r,
    metadata: JSON.parse(r.metadata),
  }));
}

export function getItemsBySource(source: string, limit = 100): Array<DbItem & { id: number }> {
  const rows = getDb()
    .prepare(`
      SELECT id, source, external_id, content, metadata, created_at
      FROM items
      WHERE source = $source
      ORDER BY created_at DESC
      LIMIT $limit
    `)
    .all({ $source: source, $limit: limit }) as any[];

  return rows.map((r) => ({
    ...r,
    metadata: JSON.parse(r.metadata),
  }));
}

export function getItemCount(): Record<string, number> {
  const rows = getDb()
    .prepare("SELECT source, COUNT(*) as count FROM items GROUP BY source")
    .all() as Array<{ source: string; count: number }>;

  const result: Record<string, number> = {};
  for (const row of rows) {
    result[row.source] = row.count;
  }
  return result;
}

// ─── Threads ─────────────────────────────────────────────────────────────────

export interface DbThread {
  id: string;
  title: string | null;
  created_at: number;
  last_message_at: number;
}

export function createThread(title?: string): string {
  const id = crypto.randomUUID();
  getDb()
    .prepare("INSERT INTO threads (id, title) VALUES ($id, $title)")
    .run({ $id: id, $title: title ?? null });
  return id;
}

export function getRecentThreads(limit = 10): DbThread[] {
  return getDb()
    .prepare("SELECT * FROM threads ORDER BY last_message_at DESC LIMIT $limit")
    .all({ $limit: limit }) as DbThread[];
}

export function getThread(id: string): DbThread | null {
  return getDb()
    .prepare("SELECT * FROM threads WHERE id = $id")
    .get({ $id: id }) as DbThread | null;
}

// ─── Messages ────────────────────────────────────────────────────────────────

export interface DbMessage {
  id: number;
  thread_id: string;
  role: "user" | "assistant" | "system";
  content: string;
  created_at: number;
}

export function addMessage(
  threadId: string,
  role: "user" | "assistant" | "system",
  content: string,
): number {
  const db = getDb();
  const result = db
    .prepare("INSERT INTO messages (thread_id, role, content) VALUES ($thread_id, $role, $content)")
    .run({ $thread_id: threadId, $role: role, $content: content });

  // Update thread's last_message_at
  db.prepare("UPDATE threads SET last_message_at = unixepoch() WHERE id = $id")
    .run({ $id: threadId });

  return Number(result.lastInsertRowid);
}

export function getMessages(threadId: string, limit = 200): DbMessage[] {
  return getDb()
    .prepare("SELECT * FROM messages WHERE thread_id = $thread_id ORDER BY created_at ASC LIMIT $limit")
    .all({ $thread_id: threadId, $limit: limit }) as DbMessage[];
}

// ─── Workflows ──────────────────────────────────────────────────────────────

export interface DbWorkflow {
  id: string;
  name: string;
  description: string;
  prompt: string;
  cron_schedule: string | null;
  type: "cron" | "manual" | "event";
  source: "default" | "user" | "suggested";
  enabled: number;
  last_run_at: number | null;
  next_run_at: number | null;
  created_at: number;
  updated_at: number;
}

export interface DbWorkflowRun {
  id: string;
  workflow_id: string;
  status: "pending" | "running" | "done" | "error";
  output: string | null;
  error: string | null;
  started_at: number;
  finished_at: number | null;
}

export function createWorkflow(opts: {
  name: string;
  prompt: string;
  description?: string;
  cron_schedule?: string;
  type?: "cron" | "manual" | "event";
  source?: "default" | "user" | "suggested";
}): string {
  const id = crypto.randomUUID();
  const type = opts.type ?? (opts.cron_schedule ? "cron" : "manual");
  getDb()
    .prepare(`
      INSERT INTO workflows (id, name, description, prompt, cron_schedule, type, source)
      VALUES ($id, $name, $description, $prompt, $cron_schedule, $type, $source)
    `)
    .run({
      $id: id,
      $name: opts.name,
      $description: opts.description ?? "",
      $prompt: opts.prompt,
      $cron_schedule: opts.cron_schedule ?? null,
      $type: type,
      $source: opts.source ?? "user",
    });
  return id;
}

export function listWorkflows(): DbWorkflow[] {
  return getDb()
    .prepare("SELECT * FROM workflows ORDER BY created_at DESC")
    .all() as DbWorkflow[];
}

export function getWorkflow(idOrName: string): DbWorkflow | null {
  return (
    getDb()
      .prepare("SELECT * FROM workflows WHERE id = $v OR name = $v")
      .get({ $v: idOrName }) as DbWorkflow | null
  );
}

export function updateWorkflow(
  id: string,
  fields: Partial<Pick<DbWorkflow, "name" | "description" | "prompt" | "cron_schedule" | "enabled" | "last_run_at" | "next_run_at">>,
): void {
  const sets: string[] = [];
  const params: Record<string, any> = { $id: id };

  for (const [key, value] of Object.entries(fields)) {
    sets.push(`${key} = $${key}`);
    params[`$${key}`] = value;
  }
  sets.push("updated_at = unixepoch()");

  if (sets.length === 1) return; // only updated_at, no real changes

  getDb()
    .prepare(`UPDATE workflows SET ${sets.join(", ")} WHERE id = $id`)
    .run(params);
}

export function deleteWorkflow(idOrName: string): boolean {
  const wf = getWorkflow(idOrName);
  if (!wf) return false;
  getDb().prepare("DELETE FROM workflows WHERE id = $id").run({ $id: wf.id });
  return true;
}

export function getDueWorkflows(now: number): DbWorkflow[] {
  // Return enabled workflows that have a cron_schedule
  // The caller (daemon) is responsible for cron matching
  return getDb()
    .prepare(`
      SELECT * FROM workflows
      WHERE enabled = 1 AND cron_schedule IS NOT NULL
    `)
    .all() as DbWorkflow[];
}

// ─── Workflow Runs ──────────────────────────────────────────────────────────

export function createWorkflowRun(workflowId: string): string {
  const id = crypto.randomUUID();
  getDb()
    .prepare("INSERT INTO workflow_runs (id, workflow_id, status) VALUES ($id, $wid, 'running')")
    .run({ $id: id, $wid: workflowId });
  return id;
}

export function finishWorkflowRun(
  id: string,
  status: "done" | "error",
  output?: string,
  error?: string,
): void {
  getDb()
    .prepare(`
      UPDATE workflow_runs
      SET status = $status, output = $output, error = $error, finished_at = unixepoch()
      WHERE id = $id
    `)
    .run({ $id: id, $status: status, $output: output ?? null, $error: error ?? null });
}

export function getWorkflowRuns(workflowId: string, limit = 20): DbWorkflowRun[] {
  return getDb()
    .prepare(`
      SELECT * FROM workflow_runs
      WHERE workflow_id = $wid
      ORDER BY started_at DESC
      LIMIT $limit
    `)
    .all({ $wid: workflowId, $limit: limit }) as DbWorkflowRun[];
}

// ─── Memories ───────────────────────────────────────────────────────────────

export type MemoryType = "person" | "project" | "topic" | "event" | "preference" | "place";

export interface DbMemory {
  id: string;
  type: MemoryType;
  title: string;
  body: string;
  sources: string; // JSON array of source names
  aliases: string; // JSON array of alternative names
  is_archived: number;
  created_at: number;
  updated_at: number;
}

export function createMemory(opts: {
  type: MemoryType;
  title: string;
  body: string;
  sources?: string[];
  aliases?: string[];
}): string {
  const id = crypto.randomUUID();
  getDb()
    .prepare(`
      INSERT INTO memories (id, type, title, body, sources, aliases)
      VALUES ($id, $type, $title, $body, $sources, $aliases)
    `)
    .run({
      $id: id,
      $type: opts.type,
      $title: opts.title,
      $body: opts.body,
      $sources: JSON.stringify(opts.sources ?? []),
      $aliases: JSON.stringify(opts.aliases ?? []),
    });
  return id;
}

export function updateMemory(
  id: string,
  fields: Partial<Pick<DbMemory, "title" | "body" | "type" | "is_archived"> & { sources: string[]; aliases: string[] }>,
): void {
  const sets: string[] = [];
  const params: Record<string, any> = { $id: id };

  for (const [key, value] of Object.entries(fields)) {
    if (key === "sources" || key === "aliases") {
      sets.push(`${key} = $${key}`);
      params[`$${key}`] = JSON.stringify(value);
    } else {
      sets.push(`${key} = $${key}`);
      params[`$${key}`] = value;
    }
  }
  sets.push("updated_at = unixepoch()");

  if (sets.length === 1) return;

  getDb()
    .prepare(`UPDATE memories SET ${sets.join(", ")} WHERE id = $id`)
    .run(params);
}

export function archiveMemory(id: string): void {
  getDb()
    .prepare("UPDATE memories SET is_archived = 1, updated_at = unixepoch() WHERE id = $id")
    .run({ $id: id });
}

export function getMemory(id: string): DbMemory | null {
  return getDb()
    .prepare("SELECT * FROM memories WHERE id = $id")
    .get({ $id: id }) as DbMemory | null;
}

export function listMemories(opts?: { type?: MemoryType; includeArchived?: boolean }): DbMemory[] {
  const conditions: string[] = [];
  const params: Record<string, any> = {};

  if (!opts?.includeArchived) {
    conditions.push("is_archived = 0");
  }
  if (opts?.type) {
    conditions.push("type = $type");
    params.$type = opts.type;
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  return getDb()
    .prepare(`SELECT * FROM memories ${where} ORDER BY updated_at DESC`)
    .all(params) as DbMemory[];
}

export function searchMemories(query: string): DbMemory[] {
  const pattern = `%${query}%`;
  return getDb()
    .prepare(`
      SELECT * FROM memories
      WHERE is_archived = 0 AND (title LIKE $q OR body LIKE $q OR aliases LIKE $q)
      ORDER BY updated_at DESC
      LIMIT 50
    `)
    .all({ $q: pattern }) as DbMemory[];
}

export function deleteMemory(id: string): boolean {
  const result = getDb()
    .prepare("DELETE FROM memories WHERE id = $id")
    .run({ $id: id });
  return result.changes > 0;
}
