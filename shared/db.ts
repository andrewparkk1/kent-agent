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
    synced_at = unixepoch()
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
