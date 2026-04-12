import { test, expect, describe, beforeAll, afterAll } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { MockSyncState, validateItem, LIVE } from "./_helpers.ts";
import { createSignalSource, signal } from "@daemon/sources/signal.ts";

let tmpRoot: string;
let dbPath: string;

// Fixed clock — 2024-06-01T00:00:00Z
const NOW_UNIX = 1717200000;

// Unix seconds for known message timestamps
const T_OLD = NOW_UNIX - 10 * 86400;
const T_MID = NOW_UNIX - 5 * 86400;
const T_NEW = NOW_UNIX - 1 * 86400;

// Signal stores sent_at as unix milliseconds.
const MS_OLD = T_OLD * 1000;
const MS_MID = T_MID * 1000;
const MS_NEW = T_NEW * 1000;

beforeAll(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), "kent-signal-test-"));
  dbPath = join(tmpRoot, "db.sqlite");

  const db = new Database(dbPath);
  // Minimal schema covering columns the source queries
  db.run(`
    CREATE TABLE conversations (
      id TEXT PRIMARY KEY,
      name TEXT,
      profileName TEXT,
      profileFullName TEXT,
      e164 TEXT,
      type TEXT
    );
  `);
  db.run(`
    CREATE TABLE messages (
      rowid INTEGER PRIMARY KEY,
      body TEXT,
      type TEXT,
      sent_at INTEGER,
      received_at INTEGER,
      conversationId TEXT
    );
  `);

  // 1:1 conversation — only e164 set, should fall back through name chain
  db.run(
    `INSERT INTO conversations (id, name, profileName, profileFullName, e164, type) VALUES (?, ?, ?, ?, ?, ?)`,
    ["conv-alice", null, "Ali", "Alice Smith", "+15551234567", "private"],
  );
  // Group conversation
  db.run(
    `INSERT INTO conversations (id, name, profileName, profileFullName, e164, type) VALUES (?, ?, ?, ?, ?, ?)`,
    ["conv-group-1", "The Crew", null, null, null, "group"],
  );
  // Conversation with nothing → Unknown
  db.run(
    `INSERT INTO conversations (id, name, profileName, profileFullName, e164, type) VALUES (?, ?, ?, ?, ?, ?)`,
    ["conv-mystery", null, null, null, null, "private"],
  );

  // Message 1 — old, 1:1 incoming
  db.run(
    `INSERT INTO messages (rowid, body, type, sent_at, received_at, conversationId) VALUES (?, ?, ?, ?, ?, ?)`,
    [1, "hey alice here", "incoming", MS_OLD, MS_OLD + 10, "conv-alice"],
  );
  // Message 2 — group outgoing, mid
  db.run(
    `INSERT INTO messages (rowid, body, type, sent_at, received_at, conversationId) VALUES (?, ?, ?, ?, ?, ?)`,
    [2, "rollcall", "outgoing", MS_MID, MS_MID + 10, "conv-group-1"],
  );
  // Message 3 — new, 1:1 incoming (most recent)
  db.run(
    `INSERT INTO messages (rowid, body, type, sent_at, received_at, conversationId) VALUES (?, ?, ?, ?, ?, ?)`,
    [3, "latest from alice", "incoming", MS_NEW, MS_NEW + 10, "conv-alice"],
  );
  // Message 4 — NULL body, should be filtered by WHERE body IS NOT NULL
  db.run(
    `INSERT INTO messages (rowid, body, type, sent_at, received_at, conversationId) VALUES (?, ?, ?, ?, ?, ?)`,
    [4, null, "incoming", MS_NEW + 1, MS_NEW + 11, "conv-alice"],
  );
  // Message 5 — empty body, also filtered
  db.run(
    `INSERT INTO messages (rowid, body, type, sent_at, received_at, conversationId) VALUES (?, ?, ?, ?, ?, ?)`,
    [5, "", "incoming", MS_NEW + 2, MS_NEW + 12, "conv-alice"],
  );
  // Message 6 — conv-mystery → Unknown contact
  db.run(
    `INSERT INTO messages (rowid, body, type, sent_at, received_at, conversationId) VALUES (?, ?, ?, ?, ?, ?)`,
    [6, "who are you", "incoming", MS_MID + 500, MS_MID + 510, "conv-mystery"],
  );

  db.close();
});

afterAll(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});

describe("signal source (fixture)", () => {
  test("fetchNew returns all non-empty messages ordered newest first", async () => {
    const source = createSignalSource({
      dbPath,
      unencrypted: true,
      now: () => NOW_UNIX,
    });
    const items = await source.fetchNew(new MockSyncState());

    expect(items).toHaveLength(4);

    // Ordered by sent_at DESC: MS_NEW (3), MS_MID+500 (6), MS_MID (2), MS_OLD (1)
    expect(items[0]!.externalId).toBe("signal-3");
    expect(items[0]!.content).toBe("latest from alice");
    expect(items[0]!.createdAt).toBe(T_NEW); // ms → s
    expect(items[0]!.source).toBe("signal");
    expect(items[0]!.metadata.conversationId).toBe("conv-alice");
    // name=null, profileFullName="Alice Smith" wins
    expect(items[0]!.metadata.contactName).toBe("Alice Smith");
    expect(items[0]!.metadata.isFromMe).toBe(false);
    expect(items[0]!.metadata.isGroup).toBe(false);

    expect(items[1]!.externalId).toBe("signal-6");
    expect(items[1]!.content).toBe("who are you");
    expect(items[1]!.metadata.contactName).toBe("Unknown");
    expect(items[1]!.metadata.conversationId).toBe("conv-mystery");
    expect(items[1]!.metadata.isGroup).toBe(false);

    expect(items[2]!.externalId).toBe("signal-2");
    expect(items[2]!.content).toBe("rollcall");
    expect(items[2]!.createdAt).toBe(T_MID);
    expect(items[2]!.metadata.isFromMe).toBe(true);
    expect(items[2]!.metadata.isGroup).toBe(true);
    expect(items[2]!.metadata.contactName).toBe("The Crew"); // conv.name wins
    expect(items[2]!.metadata.conversationId).toBe("conv-group-1");

    expect(items[3]!.externalId).toBe("signal-1");
    expect(items[3]!.createdAt).toBe(T_OLD);
  });

  test("markSynced cutoff excludes messages at or before last sync", async () => {
    const source = createSignalSource({
      dbPath,
      unencrypted: true,
      now: () => NOW_UNIX,
    });
    const state = new MockSyncState();
    // Last sync at T_MID (unix seconds). The source converts to ms and uses `sent_at > lastSyncMs`.
    state.markSynced("signal", T_MID);
    const items = await source.fetchNew(state);
    // Strictly greater than MS_MID: MS_MID+500 (6) and MS_NEW (3)
    expect(items).toHaveLength(2);
    expect(items.map((i) => i.externalId).sort()).toEqual([
      "signal-3",
      "signal-6",
    ]);
  });

  test("markSynced at NOW returns nothing", async () => {
    const source = createSignalSource({
      dbPath,
      unencrypted: true,
      now: () => NOW_UNIX,
    });
    const state = new MockSyncState();
    state.markSynced("signal", NOW_UNIX);
    const items = await source.fetchNew(state);
    expect(items).toHaveLength(0);
  });

  test("limit option is respected", async () => {
    const source = createSignalSource({
      dbPath,
      unencrypted: true,
      now: () => NOW_UNIX,
    });
    const items = await source.fetchNew(new MockSyncState(), { limit: 1 });
    expect(items).toHaveLength(1);
    expect(items[0]!.externalId).toBe("signal-3");
  });

  test("missing db returns empty array gracefully", async () => {
    const source = createSignalSource({
      dbPath: join(tmpRoot, "does-not-exist.sqlite"),
      unencrypted: true,
    });
    const items = await source.fetchNew(new MockSyncState());
    expect(items).toEqual([]);
  });

  test("production export is still usable", async () => {
    expect(signal.name).toBe("signal");
    expect(typeof signal.fetchNew).toBe("function");
  });

  test.skipIf(!LIVE)("LIVE: reads from real Signal Desktop sqlite", async () => {
    const items = await signal.fetchNew(new MockSyncState(), { defaultDays: 7, limit: 10 });
    for (const item of items) validateItem(item, "signal", /^signal-/);
  }, 60_000);
});
