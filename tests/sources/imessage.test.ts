import { test, expect, describe, beforeAll, afterAll } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { MockSyncState, validateItem, LIVE } from "./_helpers.ts";
import {
  createImessageSource,
  imessage,
  appleTimeToUnix,
  extractFromAttributedBody,
} from "@daemon/sources/imessage.ts";

const APPLE_EPOCH_OFFSET = 978307200;

/** Unix seconds → Apple Messages nanoseconds. */
function unixToAppleNs(unix: number): number {
  return (unix - APPLE_EPOCH_OFFSET) * 1_000_000_000;
}

/** Build a minimal NSKeyedArchiver blob that the source will extract as `text`. */
function buildAttributedBody(text: string): Buffer {
  return Buffer.concat([
    Buffer.from("bplist00", "ascii"),
    Buffer.from("NSString", "ascii"),
    Buffer.alloc(8, 0x00), // 8 skipped bytes after "NSString"
    Buffer.from([0x2b, text.length]), // '+' then length byte
    Buffer.from(text, "utf-8"),
    Buffer.from([0x00]),
  ]);
}

let tmpRoot: string;
let dbPath: string;

// Fixed clock — 2024-06-01T00:00:00Z
const NOW_UNIX = 1717200000;

const T_OLD = NOW_UNIX - 10 * 86400;
const T_MID = NOW_UNIX - 5 * 86400;
const T_NEW = NOW_UNIX - 1 * 86400;
const T_NEWEST = NOW_UNIX - 3600;

beforeAll(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), "kent-imessage-test-"));
  dbPath = join(tmpRoot, "chat.db");

  const db = new Database(dbPath);

  // Minimal schema matching the columns the source queries
  db.run(`
    CREATE TABLE handle (
      ROWID INTEGER PRIMARY KEY,
      id TEXT
    );
  `);
  db.run(`
    CREATE TABLE chat (
      ROWID INTEGER PRIMARY KEY,
      chat_identifier TEXT,
      display_name TEXT
    );
  `);
  db.run(`
    CREATE TABLE chat_handle_join (
      chat_id INTEGER,
      handle_id INTEGER
    );
  `);
  db.run(`
    CREATE TABLE chat_message_join (
      chat_id INTEGER,
      message_id INTEGER
    );
  `);
  db.run(`
    CREATE TABLE message (
      ROWID INTEGER PRIMARY KEY,
      text TEXT,
      date INTEGER,
      is_from_me INTEGER,
      service TEXT,
      attributedBody BLOB,
      handle_id INTEGER
    );
  `);

  // Handles: one 1:1 contact and two group members
  db.run(`INSERT INTO handle (ROWID, id) VALUES (?, ?)`, [10, "+15551234567"]);
  db.run(`INSERT INTO handle (ROWID, id) VALUES (?, ?)`, [11, "+15559990001"]);
  db.run(`INSERT INTO handle (ROWID, id) VALUES (?, ?)`, [12, "+15559990002"]);

  // Chats:
  //  - chat 1: 1:1 with handle 10 (iMessage;-;+15551234567)
  //  - chat 2: group with a display_name "Family"
  //  - chat 3: named group chat (chat_identifier starts with 'chat') no display_name
  db.run(
    `INSERT INTO chat (ROWID, chat_identifier, display_name) VALUES (?, ?, ?)`,
    [1, "iMessage;-;+15551234567", null],
  );
  db.run(
    `INSERT INTO chat (ROWID, chat_identifier, display_name) VALUES (?, ?, ?)`,
    [2, "chat000000000000000001", "Family"],
  );
  db.run(
    `INSERT INTO chat (ROWID, chat_identifier, display_name) VALUES (?, ?, ?)`,
    [3, "chat000000000000000002", null],
  );

  // chat_handle_join: link handles to chats
  db.run(`INSERT INTO chat_handle_join (chat_id, handle_id) VALUES (?, ?)`, [1, 10]);
  db.run(`INSERT INTO chat_handle_join (chat_id, handle_id) VALUES (?, ?)`, [2, 10]);
  db.run(`INSERT INTO chat_handle_join (chat_id, handle_id) VALUES (?, ?)`, [2, 11]);
  db.run(`INSERT INTO chat_handle_join (chat_id, handle_id) VALUES (?, ?)`, [3, 11]);
  db.run(`INSERT INTO chat_handle_join (chat_id, handle_id) VALUES (?, ?)`, [3, 12]);

  // Messages:
  // 1: 1:1 incoming, plain text, old
  db.run(
    `INSERT INTO message (ROWID, text, date, is_from_me, service, attributedBody, handle_id) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [1001, "hello from alice", unixToAppleNs(T_OLD), 0, "iMessage", null, 10],
  );
  // 2: group (display_name=Family) outgoing, plain text, mid
  db.run(
    `INSERT INTO message (ROWID, text, date, is_from_me, service, attributedBody, handle_id) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [1002, "hey family", unixToAppleNs(T_MID), 1, "iMessage", null, null],
  );
  // 3: 1:1 incoming, NULL text with non-empty attributedBody (NSKeyedArchiver fallback), new
  db.run(
    `INSERT INTO message (ROWID, text, date, is_from_me, service, attributedBody, handle_id) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      1003,
      null,
      unixToAppleNs(T_NEW),
      0,
      "iMessage",
      buildAttributedBody("rich formatted reply"),
      10,
    ],
  );
  // 4: named group chat (no display_name) incoming, newest
  db.run(
    `INSERT INTO message (ROWID, text, date, is_from_me, service, attributedBody, handle_id) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [1004, "ping from crew", unixToAppleNs(T_NEWEST), 0, "iMessage", null, 11],
  );
  // 5: empty message (no text and no body) — should be dropped
  db.run(
    `INSERT INTO message (ROWID, text, date, is_from_me, service, attributedBody, handle_id) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [1005, null, unixToAppleNs(T_NEW + 10), 0, "iMessage", null, 10],
  );

  // Link messages to chats
  db.run(`INSERT INTO chat_message_join (chat_id, message_id) VALUES (?, ?)`, [1, 1001]);
  db.run(`INSERT INTO chat_message_join (chat_id, message_id) VALUES (?, ?)`, [2, 1002]);
  db.run(`INSERT INTO chat_message_join (chat_id, message_id) VALUES (?, ?)`, [1, 1003]);
  db.run(`INSERT INTO chat_message_join (chat_id, message_id) VALUES (?, ?)`, [3, 1004]);
  db.run(`INSERT INTO chat_message_join (chat_id, message_id) VALUES (?, ?)`, [1, 1005]);

  db.close();
});

afterAll(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});

describe("imessage source (fixture)", () => {
  test("fetchNew returns messages with exact expected shape and order", async () => {
    const source = createImessageSource({
      chatDbPath: dbPath,
      addressBookDbs: [],
      now: () => NOW_UNIX,
    });
    const items = await source.fetchNew(new MockSyncState());

    // 4 non-empty messages (empty one at ROWID 1005 is dropped)
    expect(items).toHaveLength(4);

    // Ordered by message.date DESC:
    // T_NEWEST (1004), T_NEW (1003), T_MID (1002), T_OLD (1001)
    // Newest: named group chat, no display_name
    const m0 = items[0]!;
    expect(m0.externalId).toBe("imessage-1004");
    expect(m0.content).toBe("ping from crew");
    expect(m0.createdAt).toBe(T_NEWEST);
    expect(m0.source).toBe("imessage");
    expect(m0.metadata.isFromMe).toBe(false);
    expect(m0.metadata.isGroup).toBe(true);
    expect(m0.metadata.service).toBe("iMessage");
    expect(m0.metadata.senderName).toBe("+15559990001");
    // No address book → conversationName falls back to participant-list string
    expect(m0.metadata.conversationName).toBe("+15559990001, +15559990002");
    expect(m0.metadata.conversationId).toBe("chat000000000000000002");
    expect(m0.metadata.handle).toBe("+15559990001");

    // #2: attributedBody fallback
    const m1 = items[1]!;
    expect(m1.externalId).toBe("imessage-1003");
    expect(m1.content).toBe("rich formatted reply");
    expect(m1.createdAt).toBe(T_NEW);
    expect(m1.metadata.isFromMe).toBe(false);
    expect(m1.metadata.isGroup).toBe(false);
    expect(m1.metadata.senderName).toBe("+15551234567");
    expect(m1.metadata.conversationName).toBe("+15551234567");
    expect(m1.metadata.conversationId).toBe("iMessage;-;+15551234567");

    // #3: group with display_name, outgoing
    const m2 = items[2]!;
    expect(m2.externalId).toBe("imessage-1002");
    expect(m2.content).toBe("hey family");
    expect(m2.createdAt).toBe(T_MID);
    expect(m2.metadata.isFromMe).toBe(true);
    expect(m2.metadata.isGroup).toBe(true);
    expect(m2.metadata.senderName).toBe("me");
    expect(m2.metadata.conversationName).toBe("Family");
    expect(m2.metadata.conversationId).toBe("chat000000000000000001");

    // #4: oldest 1:1 incoming plain text
    const m3 = items[3]!;
    expect(m3.externalId).toBe("imessage-1001");
    expect(m3.content).toBe("hello from alice");
    expect(m3.createdAt).toBe(T_OLD);
    expect(m3.metadata.isFromMe).toBe(false);
    expect(m3.metadata.isGroup).toBe(false);
    expect(m3.metadata.senderName).toBe("+15551234567");
    expect(m3.metadata.conversationName).toBe("+15551234567");
  });

  test("markSynced cutoff filters out older messages", async () => {
    const source = createImessageSource({
      chatDbPath: dbPath,
      addressBookDbs: [],
      now: () => NOW_UNIX,
    });
    const state = new MockSyncState();
    state.markSynced("imessage", T_MID);
    const items = await source.fetchNew(state);
    // Strictly newer than T_MID: T_NEWEST (1004) and T_NEW (1003)
    expect(items).toHaveLength(2);
    expect(items.map((i) => i.externalId).sort()).toEqual([
      "imessage-1003",
      "imessage-1004",
    ]);
  });

  test("markSynced at NOW returns nothing", async () => {
    const source = createImessageSource({
      chatDbPath: dbPath,
      addressBookDbs: [],
      now: () => NOW_UNIX,
    });
    const state = new MockSyncState();
    state.markSynced("imessage", NOW_UNIX);
    const items = await source.fetchNew(state);
    expect(items).toHaveLength(0);
  });

  test("defaultDays uses injected clock", async () => {
    const source = createImessageSource({
      chatDbPath: dbPath,
      addressBookDbs: [],
      now: () => NOW_UNIX,
    });
    // defaultDays=3 → only messages newer than NOW-3d qualify: T_NEWEST (1004) and T_NEW (1003)
    const items = await source.fetchNew(new MockSyncState(), { defaultDays: 3 });
    expect(items).toHaveLength(2);
    expect(items.map((i) => i.externalId).sort()).toEqual([
      "imessage-1003",
      "imessage-1004",
    ]);
  });

  test("missing db returns empty array gracefully", async () => {
    const source = createImessageSource({
      chatDbPath: join(tmpRoot, "nonexistent.db"),
      addressBookDbs: [],
      now: () => NOW_UNIX,
    });
    const items = await source.fetchNew(new MockSyncState());
    expect(items).toEqual([]);
  });

  test("production export is still usable", async () => {
    const { imessage } = await import("@daemon/sources/imessage.ts");
    expect(imessage.name).toBe("imessage");
    expect(typeof imessage.fetchNew).toBe("function");
  });
});

describe("imessage helpers", () => {
  test("appleTimeToUnix converts nanosecond timestamps", () => {
    // 2024-06-01T00:00:00Z
    const unix = 1717200000;
    const appleNs = (unix - APPLE_EPOCH_OFFSET) * 1_000_000_000;
    expect(appleTimeToUnix(appleNs)).toBe(unix);
  });

  test("appleTimeToUnix converts second-based legacy timestamps", () => {
    // Legacy path: values below 1e10 are treated as seconds since 2001-01-01
    // 100 seconds into Apple epoch → 978307200 + 100
    expect(appleTimeToUnix(100)).toBe(APPLE_EPOCH_OFFSET + 100);
  });

  test("appleTimeToUnix handles zero", () => {
    expect(appleTimeToUnix(0)).toBe(APPLE_EPOCH_OFFSET);
  });

  test("extractFromAttributedBody returns the NSString payload", () => {
    const expected = "it works!";
    const buf = Buffer.concat([
      Buffer.from("bplist00", "ascii"),
      Buffer.from("NSString", "ascii"),
      Buffer.alloc(8, 0x00),
      Buffer.from([0x2b, expected.length]),
      Buffer.from(expected, "utf-8"),
    ]);
    expect(extractFromAttributedBody(buf)).toBe(expected);
  });

  test("extractFromAttributedBody returns null on missing marker", () => {
    expect(extractFromAttributedBody(Buffer.from("no marker here"))).toBeNull();
  });

  test("extractFromAttributedBody returns null on empty buffer", () => {
    expect(extractFromAttributedBody(Buffer.alloc(0))).toBeNull();
  });

  test.skipIf(!LIVE)("LIVE: reads from real ~/Library/Messages/chat.db", async () => {
    const items = await imessage.fetchNew(new MockSyncState(), { defaultDays: 7, limit: 10 });
    for (const item of items) validateItem(item, "imessage", /^imessage-/);
  }, 60_000);
});
