import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import { Database } from "bun:sqlite";

/**
 * Tests for the DB layer (shared/db.ts).
 *
 * We replicate the schema from db.ts and test query logic directly
 * against an in-memory SQLite database — no filesystem side-effects.
 */

function createTestDb(): Database {
  const db = new Database(":memory:");
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA foreign_keys = ON");
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
  return db;
}

// ─── Helpers that mirror db.ts functions but accept a db instance ────────────

function upsertItems(db: Database, items: Array<{ source: string; external_id: string; content: string; metadata: Record<string, any>; created_at: number }>): number {
  const stmt = db.prepare(`
    INSERT INTO items (source, external_id, content, metadata, created_at)
    VALUES ($source, $external_id, $content, $metadata, $created_at)
    ON CONFLICT(source, external_id) DO UPDATE SET
      content = excluded.content,
      metadata = excluded.metadata,
      synced_at = unixepoch()
  `);
  let count = 0;
  const tx = db.transaction(() => {
    for (const item of items) {
      stmt.run({
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

function searchItems(db: Database, query: string, limit = 50) {
  const rows = db
    .prepare(`
      SELECT id, source, external_id, content, metadata, created_at
      FROM items WHERE content LIKE $query
      ORDER BY created_at DESC LIMIT $limit
    `)
    .all({ $query: `%${query}%`, $limit: limit }) as any[];
  return rows.map((r) => ({ ...r, metadata: JSON.parse(r.metadata) }));
}

function getItemsBySource(db: Database, source: string, limit = 100) {
  const rows = db
    .prepare(`
      SELECT id, source, external_id, content, metadata, created_at
      FROM items WHERE source = $source
      ORDER BY created_at DESC LIMIT $limit
    `)
    .all({ $source: source, $limit: limit }) as any[];
  return rows.map((r) => ({ ...r, metadata: JSON.parse(r.metadata) }));
}

function getItemCount(db: Database): Record<string, number> {
  const rows = db
    .prepare("SELECT source, COUNT(*) as count FROM items GROUP BY source")
    .all() as Array<{ source: string; count: number }>;
  const result: Record<string, number> = {};
  for (const row of rows) result[row.source] = row.count;
  return result;
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("Database schema", () => {
  let db: Database;
  beforeEach(() => { db = createTestDb(); });
  afterEach(() => { db.close(); });

  test("items table exists with expected columns", () => {
    const info = db.prepare("PRAGMA table_info(items)").all() as Array<{ name: string }>;
    const cols = info.map((c) => c.name);
    expect(cols).toContain("id");
    expect(cols).toContain("source");
    expect(cols).toContain("external_id");
    expect(cols).toContain("content");
    expect(cols).toContain("metadata");
    expect(cols).toContain("created_at");
    expect(cols).toContain("synced_at");
  });

  test("threads table exists with expected columns", () => {
    const info = db.prepare("PRAGMA table_info(threads)").all() as Array<{ name: string }>;
    const cols = info.map((c) => c.name);
    expect(cols).toContain("id");
    expect(cols).toContain("title");
    expect(cols).toContain("created_at");
    expect(cols).toContain("last_message_at");
  });

  test("messages table exists with role CHECK constraint", () => {
    const threadId = "test-thread";
    db.prepare("INSERT INTO threads (id, title) VALUES ($id, $title)")
      .run({ $id: threadId, $title: "Test" });

    // Valid roles should work
    for (const role of ["user", "assistant", "system"]) {
      db.prepare("INSERT INTO messages (thread_id, role, content) VALUES ($t, $r, $c)")
        .run({ $t: threadId, $r: role, $c: "hello" });
    }

    // Invalid role should fail
    expect(() => {
      db.prepare("INSERT INTO messages (thread_id, role, content) VALUES ($t, $r, $c)")
        .run({ $t: threadId, $r: "invalid", $c: "hello" });
    }).toThrow();
  });

  test("messages foreign key constraint enforced", () => {
    expect(() => {
      db.prepare("INSERT INTO messages (thread_id, role, content) VALUES ($t, $r, $c)")
        .run({ $t: "nonexistent", $r: "user", $c: "hello" });
    }).toThrow();
  });

  test("items unique constraint on (source, external_id)", () => {
    db.prepare("INSERT INTO items (source, external_id, content, created_at) VALUES ('s', 'e1', 'c1', 100)")
      .run();

    expect(() => {
      db.prepare("INSERT INTO items (source, external_id, content, created_at) VALUES ('s', 'e1', 'c2', 200)")
        .run();
    }).toThrow();
  });
});

describe("upsertItems", () => {
  let db: Database;
  beforeEach(() => { db = createTestDb(); });
  afterEach(() => { db.close(); });

  test("inserts new items", () => {
    const count = upsertItems(db, [
      { source: "imessage", external_id: "msg-1", content: "Hello", metadata: { sender: "Alice" }, created_at: 1000 },
      { source: "imessage", external_id: "msg-2", content: "World", metadata: { sender: "Bob" }, created_at: 1001 },
    ]);
    expect(count).toBe(2);

    const all = db.prepare("SELECT * FROM items").all() as any[];
    expect(all.length).toBe(2);
  });

  test("upserts on conflict — updates content and metadata", () => {
    upsertItems(db, [
      { source: "gmail", external_id: "email-1", content: "Original", metadata: { subject: "Old" }, created_at: 1000 },
    ]);

    upsertItems(db, [
      { source: "gmail", external_id: "email-1", content: "Updated", metadata: { subject: "New" }, created_at: 1000 },
    ]);

    const rows = db.prepare("SELECT content, metadata FROM items WHERE external_id = 'email-1'").all() as any[];
    expect(rows.length).toBe(1);
    expect(rows[0].content).toBe("Updated");
    expect(JSON.parse(rows[0].metadata).subject).toBe("New");
  });

  test("handles empty array", () => {
    const count = upsertItems(db, []);
    expect(count).toBe(0);
  });

  test("handles large batch in a single transaction", () => {
    const items = Array.from({ length: 500 }, (_, i) => ({
      source: "test",
      external_id: `item-${i}`,
      content: `Content ${i}`,
      metadata: { index: i },
      created_at: 1000 + i,
    }));

    const count = upsertItems(db, items);
    expect(count).toBe(500);

    const total = db.prepare("SELECT COUNT(*) as c FROM items").get() as any;
    expect(total.c).toBe(500);
  });

  test("stores metadata as JSON string", () => {
    upsertItems(db, [
      { source: "test", external_id: "x", content: "c", metadata: { nested: { a: 1 }, arr: [1, 2] }, created_at: 1 },
    ]);

    const row = db.prepare("SELECT metadata FROM items").get() as any;
    const parsed = JSON.parse(row.metadata);
    expect(parsed.nested.a).toBe(1);
    expect(parsed.arr).toEqual([1, 2]);
  });

  test("different sources can have same external_id", () => {
    upsertItems(db, [
      { source: "imessage", external_id: "id-1", content: "a", metadata: {}, created_at: 1 },
      { source: "gmail", external_id: "id-1", content: "b", metadata: {}, created_at: 2 },
    ]);

    const all = db.prepare("SELECT * FROM items").all() as any[];
    expect(all.length).toBe(2);
  });
});

describe("searchItems", () => {
  let db: Database;
  beforeEach(() => {
    db = createTestDb();
    upsertItems(db, [
      { source: "imessage", external_id: "m1", content: "Hey Alice, meeting at 3pm", metadata: {}, created_at: 1000 },
      { source: "imessage", external_id: "m2", content: "Lunch tomorrow?", metadata: {}, created_at: 2000 },
      { source: "gmail", external_id: "e1", content: "Meeting notes from standup", metadata: {}, created_at: 3000 },
      { source: "github", external_id: "g1", content: "Fix bug in parser", metadata: {}, created_at: 4000 },
    ]);
  });
  afterEach(() => { db.close(); });

  test("finds items by content substring", () => {
    const results = searchItems(db, "meeting");
    expect(results.length).toBe(2);
  });

  test("returns results ordered by created_at DESC", () => {
    const results = searchItems(db, "meeting");
    expect(results[0].created_at).toBeGreaterThanOrEqual(results[1].created_at);
  });

  test("returns empty array for no matches", () => {
    const results = searchItems(db, "xyznonexistent");
    expect(results).toEqual([]);
  });

  test("respects limit parameter", () => {
    const results = searchItems(db, "m", 2);
    expect(results.length).toBeLessThanOrEqual(2);
  });

  test("parses metadata back to object", () => {
    upsertItems(db, [
      { source: "test", external_id: "t1", content: "searchable thing", metadata: { key: "value" }, created_at: 5000 },
    ]);
    const results = searchItems(db, "searchable");
    expect(results[0].metadata).toEqual({ key: "value" });
  });

  test("search is case-insensitive", () => {
    const upper = searchItems(db, "MEETING");
    const lower = searchItems(db, "meeting");
    expect(upper.length).toBe(lower.length);
  });
});

describe("getItemsBySource", () => {
  let db: Database;
  beforeEach(() => {
    db = createTestDb();
    upsertItems(db, [
      { source: "imessage", external_id: "m1", content: "msg 1", metadata: {}, created_at: 1000 },
      { source: "imessage", external_id: "m2", content: "msg 2", metadata: {}, created_at: 2000 },
      { source: "gmail", external_id: "e1", content: "email 1", metadata: {}, created_at: 3000 },
    ]);
  });
  afterEach(() => { db.close(); });

  test("returns only items from specified source", () => {
    const results = getItemsBySource(db, "imessage");
    expect(results.length).toBe(2);
    expect(results.every((r) => r.source === "imessage")).toBe(true);
  });

  test("returns empty for unknown source", () => {
    const results = getItemsBySource(db, "nonexistent");
    expect(results).toEqual([]);
  });

  test("orders by created_at DESC", () => {
    const results = getItemsBySource(db, "imessage");
    expect(results[0].created_at).toBe(2000);
    expect(results[1].created_at).toBe(1000);
  });

  test("respects limit", () => {
    const results = getItemsBySource(db, "imessage", 1);
    expect(results.length).toBe(1);
  });
});

describe("getItemCount", () => {
  let db: Database;
  beforeEach(() => { db = createTestDb(); });
  afterEach(() => { db.close(); });

  test("returns counts grouped by source", () => {
    upsertItems(db, [
      { source: "imessage", external_id: "m1", content: "a", metadata: {}, created_at: 1 },
      { source: "imessage", external_id: "m2", content: "b", metadata: {}, created_at: 2 },
      { source: "gmail", external_id: "e1", content: "c", metadata: {}, created_at: 3 },
    ]);

    const counts = getItemCount(db);
    expect(counts.imessage).toBe(2);
    expect(counts.gmail).toBe(1);
  });

  test("returns empty object when no items", () => {
    const counts = getItemCount(db);
    expect(counts).toEqual({});
  });
});

describe("Threads and Messages", () => {
  let db: Database;
  beforeEach(() => { db = createTestDb(); });
  afterEach(() => { db.close(); });

  test("create and retrieve a thread", () => {
    const id = crypto.randomUUID();
    db.prepare("INSERT INTO threads (id, title) VALUES ($id, $title)")
      .run({ $id: id, $title: "Test Thread" });

    const thread = db.prepare("SELECT * FROM threads WHERE id = $id")
      .get({ $id: id }) as any;
    expect(thread).not.toBeNull();
    expect(thread.title).toBe("Test Thread");
    expect(thread.created_at).toBeGreaterThan(0);
  });

  test("thread with null title", () => {
    const id = crypto.randomUUID();
    db.prepare("INSERT INTO threads (id, title) VALUES ($id, $title)")
      .run({ $id: id, $title: null });

    const thread = db.prepare("SELECT * FROM threads WHERE id = $id")
      .get({ $id: id }) as any;
    expect(thread.title).toBeNull();
  });

  test("add messages to a thread and retrieve in order", () => {
    const threadId = crypto.randomUUID();
    db.prepare("INSERT INTO threads (id, title) VALUES ($id, $title)")
      .run({ $id: threadId, $title: "Chat" });

    db.prepare("INSERT INTO messages (thread_id, role, content) VALUES ($t, $r, $c)")
      .run({ $t: threadId, $r: "user", $c: "Hello" });
    db.prepare("INSERT INTO messages (thread_id, role, content) VALUES ($t, $r, $c)")
      .run({ $t: threadId, $r: "assistant", $c: "Hi there!" });
    db.prepare("INSERT INTO messages (thread_id, role, content) VALUES ($t, $r, $c)")
      .run({ $t: threadId, $r: "system", $c: "Context loaded" });

    const messages = db
      .prepare("SELECT * FROM messages WHERE thread_id = $t ORDER BY created_at ASC")
      .all({ $t: threadId }) as any[];

    expect(messages.length).toBe(3);
    expect(messages[0].role).toBe("user");
    expect(messages[0].content).toBe("Hello");
    expect(messages[1].role).toBe("assistant");
    expect(messages[2].role).toBe("system");
  });

  test("getRecentThreads returns newest first", () => {
    for (let i = 0; i < 5; i++) {
      const id = crypto.randomUUID();
      db.prepare("INSERT INTO threads (id, title, last_message_at) VALUES ($id, $title, $t)")
        .run({ $id: id, $title: `Thread ${i}`, $t: 1000 + i });
    }

    const threads = db
      .prepare("SELECT * FROM threads ORDER BY last_message_at DESC LIMIT 10")
      .all() as any[];

    expect(threads.length).toBe(5);
    expect(threads[0].title).toBe("Thread 4");
    expect(threads[4].title).toBe("Thread 0");
  });

  test("getThread returns null for nonexistent id", () => {
    const thread = db.prepare("SELECT * FROM threads WHERE id = $id")
      .get({ $id: "nonexistent" });
    expect(thread).toBeNull();
  });

  test("adding message updates thread last_message_at", () => {
    const threadId = crypto.randomUUID();
    db.prepare("INSERT INTO threads (id, title, last_message_at) VALUES ($id, $title, 1000)")
      .run({ $id: threadId, $title: "Chat" });

    // Simulate addMessage behavior from db.ts
    db.prepare("INSERT INTO messages (thread_id, role, content) VALUES ($t, $r, $c)")
      .run({ $t: threadId, $r: "user", $c: "Hello" });
    db.prepare("UPDATE threads SET last_message_at = unixepoch() WHERE id = $id")
      .run({ $id: threadId });

    const thread = db.prepare("SELECT last_message_at FROM threads WHERE id = $id")
      .get({ $id: threadId }) as any;
    expect(thread.last_message_at).toBeGreaterThan(1000);
  });
});
