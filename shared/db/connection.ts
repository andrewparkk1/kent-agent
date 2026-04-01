/**
 * Database connection singleton and schema initialization.
 * All other db modules import getDb() from here.
 */
import { Database } from "bun:sqlite";
import { join } from "node:path";
import { KENT_DIR, ensureKentDir } from "../config.ts";

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
  // Workflows: add type/source columns
  const wfCols = db.prepare("PRAGMA table_info(workflows)").all() as any[];
  const wfColNames = wfCols.map((c: any) => c.name);
  if (wfCols.length > 0 && !wfColNames.includes("type")) {
    db.exec("ALTER TABLE workflows ADD COLUMN type TEXT NOT NULL DEFAULT 'cron'");
  }
  if (wfCols.length > 0 && !wfColNames.includes("source")) {
    db.exec("ALTER TABLE workflows ADD COLUMN source TEXT NOT NULL DEFAULT 'user'");
  }

  // Threads: add type, workflow_id, status, started_at, finished_at
  const thCols = db.prepare("PRAGMA table_info(threads)").all() as any[];
  const thColNames = thCols.map((c: any) => c.name);
  if (thCols.length > 0 && !thColNames.includes("type")) {
    db.exec("ALTER TABLE threads ADD COLUMN type TEXT NOT NULL DEFAULT 'chat'");
  }
  if (thCols.length > 0 && !thColNames.includes("workflow_id")) {
    db.exec("ALTER TABLE threads ADD COLUMN workflow_id TEXT");
  }
  if (thCols.length > 0 && !thColNames.includes("status")) {
    db.exec("ALTER TABLE threads ADD COLUMN status TEXT");
  }
  if (thCols.length > 0 && !thColNames.includes("started_at")) {
    db.exec("ALTER TABLE threads ADD COLUMN started_at INTEGER");
  }
  if (thCols.length > 0 && !thColNames.includes("finished_at")) {
    db.exec("ALTER TABLE threads ADD COLUMN finished_at INTEGER");
  }

  // Messages: add metadata column
  const msgCols = db.prepare("PRAGMA table_info(messages)").all() as any[];
  const msgColNames = msgCols.map((c: any) => c.name);
  if (msgCols.length > 0 && !msgColNames.includes("metadata")) {
    db.exec("ALTER TABLE messages ADD COLUMN metadata TEXT");
  }

  // Drop workflow_runs if it exists (migrated to threads)
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='workflow_runs'").all();
  if (tables.length > 0) {
    db.exec("DROP TABLE workflow_runs");
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
      type TEXT NOT NULL DEFAULT 'chat' CHECK(type IN ('chat', 'workflow')),
      workflow_id TEXT REFERENCES workflows(id) ON DELETE SET NULL,
      status TEXT CHECK(status IN ('running', 'done', 'error')),
      started_at INTEGER,
      finished_at INTEGER,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      last_message_at INTEGER NOT NULL DEFAULT (unixepoch())
    );

    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      thread_id TEXT NOT NULL REFERENCES threads(id),
      role TEXT NOT NULL CHECK(role IN ('user', 'assistant', 'system', 'tool')),
      content TEXT NOT NULL,
      metadata TEXT,
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

    CREATE INDEX IF NOT EXISTS idx_threads_workflow ON threads(workflow_id, started_at);
    CREATE INDEX IF NOT EXISTS idx_threads_type ON threads(type, last_message_at);

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
