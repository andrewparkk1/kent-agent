/**
 * Database connection singleton — Kysely + bun:sqlite.
 * Handles schema creation and migrations.
 */
import { Database as BunDatabase } from "bun:sqlite";
import { Kysely } from "kysely";
import { BunSqliteDialect } from "kysely-bun-sqlite";
import { join } from "node:path";
import { KENT_DIR, ensureKentDir } from "../config.ts";
import type { Database } from "./schema.ts";

const DB_PATH = join(KENT_DIR, "kent.db");

let _db: Kysely<Database> | null = null;
let _raw: BunDatabase | null = null;

/** Get the Kysely database instance. */
export function getDb(): Kysely<Database> {
  if (_db) return _db;

  ensureKentDir();
  _raw = new BunDatabase(DB_PATH);
  _raw.exec("PRAGMA journal_mode = WAL");
  _raw.exec("PRAGMA foreign_keys = ON");
  _raw.exec("PRAGMA busy_timeout = 5000");

  _db = new Kysely<Database>({
    dialect: new BunSqliteDialect({ database: _raw }),
  });

  initSchema(_raw);
  runMigrations(_raw);
  rebuildFtsIndex(_raw);
  return _db;
}

/** Get the raw bun:sqlite instance for operations Kysely can't do (FTS5, transactions). */
export function getRawDb(): BunDatabase {
  getDb(); // ensure initialized
  return _raw!;
}

// ─── FTS rebuild ────────────────────────────────────────────────────────────

function rebuildFtsIndex(db: BunDatabase): void {
  const count = (db.prepare("SELECT COUNT(*) as n FROM items").get() as any)?.n ?? 0;
  if (count === 0) return;
  const ftsCount = (db.prepare("SELECT COUNT(*) as n FROM items_fts").get() as any)?.n ?? 0;
  if (ftsCount > 0) return;
  db.exec("INSERT INTO items_fts(rowid, content, source, external_id) SELECT id, content, source, external_id FROM items");
}

// ─── Migrations ─────────────────────────────────────────────────────────────

function runMigrations(db: BunDatabase): void {
  const colNames = (table: string) => {
    const cols = db.prepare(`PRAGMA table_info(${table})`).all() as any[];
    return cols.map((c: any) => c.name);
  };

  // Workflows: add type/source/is_archived
  const wfCols = colNames("workflows");
  if (wfCols.length > 0) {
    if (!wfCols.includes("type")) db.exec("ALTER TABLE workflows ADD COLUMN type TEXT NOT NULL DEFAULT 'cron'");
    if (!wfCols.includes("source")) db.exec("ALTER TABLE workflows ADD COLUMN source TEXT NOT NULL DEFAULT 'user'");
    if (!wfCols.includes("is_archived")) db.exec("ALTER TABLE workflows ADD COLUMN is_archived INTEGER NOT NULL DEFAULT 0");
  }

  // Threads: add type, workflow_id, status, started_at, finished_at
  const thCols = colNames("threads");
  if (thCols.length > 0) {
    if (!thCols.includes("type")) db.exec("ALTER TABLE threads ADD COLUMN type TEXT NOT NULL DEFAULT 'chat'");
    if (!thCols.includes("workflow_id")) db.exec("ALTER TABLE threads ADD COLUMN workflow_id TEXT");
    if (!thCols.includes("status")) db.exec("ALTER TABLE threads ADD COLUMN status TEXT");
    if (!thCols.includes("started_at")) db.exec("ALTER TABLE threads ADD COLUMN started_at INTEGER");
    if (!thCols.includes("finished_at")) db.exec("ALTER TABLE threads ADD COLUMN finished_at INTEGER");
    if (!thCols.includes("channel")) {
      db.exec("ALTER TABLE threads ADD COLUMN channel TEXT");
      // Backfill: mark existing Telegram chat threads so they drop out of the sidebar
      db.exec("UPDATE threads SET channel = 'telegram' WHERE type = 'chat' AND title = 'telegram chat'");
    }
  }

  // Messages: add metadata
  const msgCols = colNames("messages");
  if (msgCols.length > 0 && !msgCols.includes("metadata")) {
    db.exec("ALTER TABLE messages ADD COLUMN metadata TEXT");
  }

  // Memories: add summary column for wiki-style pages
  const memCols = colNames("memories");
  if (memCols.length > 0 && !memCols.includes("summary")) {
    db.exec("ALTER TABLE memories ADD COLUMN summary TEXT NOT NULL DEFAULT ''");
  }

  // Create indexes that depend on migrated columns
  db.exec("CREATE INDEX IF NOT EXISTS idx_threads_workflow ON threads(workflow_id, started_at)");
  db.exec("CREATE INDEX IF NOT EXISTS idx_threads_type ON threads(type, last_message_at)");

  // Drop legacy workflow_runs table
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='workflow_runs'").all();
  if (tables.length > 0) db.exec("DROP TABLE workflow_runs");
}

// ─── Schema ─────────────────────────────────────────────────────────────────

function initSchema(db: BunDatabase): void {
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
      content, source UNINDEXED, external_id UNINDEXED,
      content=items, content_rowid=id, tokenize='porter unicode61'
    );

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

    -- workflows must be created before threads (threads references workflows via FK)
    CREATE TABLE IF NOT EXISTS workflows (
      id TEXT PRIMARY KEY,
      name TEXT UNIQUE NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      prompt TEXT NOT NULL,
      cron_schedule TEXT,
      type TEXT NOT NULL DEFAULT 'cron' CHECK(type IN ('cron', 'manual', 'event')),
      source TEXT NOT NULL DEFAULT 'user' CHECK(source IN ('default', 'user', 'suggested')),
      enabled INTEGER NOT NULL DEFAULT 1,
      is_archived INTEGER NOT NULL DEFAULT 0,
      last_run_at INTEGER,
      next_run_at INTEGER,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch())
    );

    CREATE TABLE IF NOT EXISTS threads (
      id TEXT PRIMARY KEY,
      title TEXT,
      type TEXT NOT NULL DEFAULT 'chat' CHECK(type IN ('chat', 'workflow')),
      workflow_id TEXT REFERENCES workflows(id) ON DELETE SET NULL,
      status TEXT CHECK(status IN ('running', 'done', 'error')),
      started_at INTEGER,
      finished_at INTEGER,
      channel TEXT,
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

    CREATE TABLE IF NOT EXISTS memories (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL CHECK(type IN ('person', 'project', 'topic', 'event', 'preference', 'place')),
      title TEXT NOT NULL,
      summary TEXT NOT NULL DEFAULT '',
      body TEXT NOT NULL DEFAULT '',
      sources TEXT NOT NULL DEFAULT '[]',
      aliases TEXT NOT NULL DEFAULT '[]',
      is_archived INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch())
    );

    CREATE INDEX IF NOT EXISTS idx_memories_type ON memories(type);
    CREATE INDEX IF NOT EXISTS idx_memories_archived ON memories(is_archived);

    CREATE TABLE IF NOT EXISTS memory_links (
      from_id TEXT NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
      to_id TEXT NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
      label TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      PRIMARY KEY (from_id, to_id)
    );

    CREATE INDEX IF NOT EXISTS idx_memory_links_to ON memory_links(to_id);

    CREATE TABLE IF NOT EXISTS kv (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    -- Suggested workflows must never be enabled
    UPDATE workflows SET enabled = 0 WHERE source = 'suggested' AND enabled = 1;
  `);
}
