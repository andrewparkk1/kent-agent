/**
 * Shared helpers for memory tests: build an in-memory SQLite database
 * with the memories + memory_links schema and wrap it in Kysely so that
 * real code paths in shared/db/memories.ts run against a real (but
 * ephemeral) database. No filesystem writes.
 */
import { Database as BunDatabase } from "bun:sqlite";
import { Kysely } from "kysely";
import { BunSqliteDialect } from "kysely-bun-sqlite";
import type { Database } from "../shared/db/schema.ts";

export function createTestMemoryDb(): { db: Kysely<Database>; raw: BunDatabase } {
  const raw = new BunDatabase(":memory:");
  raw.exec("PRAGMA foreign_keys = ON");
  raw.exec(`
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
  `);

  const db = new Kysely<Database>({
    dialect: new BunSqliteDialect({ database: raw }),
  });
  return { db, raw };
}
