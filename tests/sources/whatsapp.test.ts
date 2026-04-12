import { test, expect, describe, beforeAll, afterAll } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { MockSyncState, validateItem, LIVE } from "./_helpers.ts";
import { createWhatsappSource, whatsapp } from "@daemon/sources/whatsapp.ts";

const CORE_DATA_EPOCH_OFFSET = 978307200;

/** Given a unix seconds timestamp, return the equivalent Core Data seconds. */
function unixToCoreData(unix: number): number {
  return unix - CORE_DATA_EPOCH_OFFSET;
}

let tmpRoot: string;
let dbPath: string;

// Fixed "now" used for tests — 2024-06-01T00:00:00Z
const NOW_UNIX = 1717200000;

// Known message timestamps (unix seconds)
const T_OLD = NOW_UNIX - 10 * 86400; // 10 days ago
const T_MID = NOW_UNIX - 5 * 86400;  // 5 days ago
const T_NEW = NOW_UNIX - 1 * 86400;  // 1 day ago

beforeAll(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), "kent-whatsapp-test-"));
  dbPath = join(tmpRoot, "ChatStorage.sqlite");

  const db = new Database(dbPath);
  db.run(`
    CREATE TABLE ZWACHATSESSION (
      Z_PK INTEGER PRIMARY KEY,
      ZCONTACTJID TEXT,
      ZPARTNERNAME TEXT
    );
  `);
  db.run(`
    CREATE TABLE ZWAMESSAGE (
      Z_PK INTEGER PRIMARY KEY,
      ZSTANZAID TEXT,
      ZTEXT TEXT,
      ZMESSAGEDATE REAL,
      ZISFROMME INTEGER,
      ZMESSAGETYPE INTEGER,
      ZCHATSESSION INTEGER
    );
  `);

  // Two chat sessions: a 1:1 and a group, plus one with no metadata
  db.run(
    `INSERT INTO ZWACHATSESSION (Z_PK, ZCONTACTJID, ZPARTNERNAME) VALUES (?, ?, ?)`,
    [1, "15551234567@s.whatsapp.net", "Alice"],
  );
  db.run(
    `INSERT INTO ZWACHATSESSION (Z_PK, ZCONTACTJID, ZPARTNERNAME) VALUES (?, ?, ?)`,
    [2, "1234567890-1600000000@g.us", "Weekend Crew"],
  );
  db.run(
    `INSERT INTO ZWACHATSESSION (Z_PK, ZCONTACTJID, ZPARTNERNAME) VALUES (?, ?, ?)`,
    [3, null, null],
  );

  // 1: 1:1 incoming (old)
  db.run(
    `INSERT INTO ZWAMESSAGE (Z_PK, ZSTANZAID, ZTEXT, ZMESSAGEDATE, ZISFROMME, ZMESSAGETYPE, ZCHATSESSION) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [101, "stanza-old", "hey from alice", unixToCoreData(T_OLD), 0, 0, 1],
  );
  // 2: group outgoing (mid)
  db.run(
    `INSERT INTO ZWAMESSAGE (Z_PK, ZSTANZAID, ZTEXT, ZMESSAGEDATE, ZISFROMME, ZMESSAGETYPE, ZCHATSESSION) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [102, "stanza-mid", "i'm in the group", unixToCoreData(T_MID), 1, 0, 2],
  );
  // 3: 1:1 incoming (new) — stanza null so externalId falls back to Z_PK
  db.run(
    `INSERT INTO ZWAMESSAGE (Z_PK, ZSTANZAID, ZTEXT, ZMESSAGEDATE, ZISFROMME, ZMESSAGETYPE, ZCHATSESSION) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [103, null, "latest reply", unixToCoreData(T_NEW), 0, 0, 1],
  );
  // 4: empty text — filtered by WHERE clause
  db.run(
    `INSERT INTO ZWAMESSAGE (Z_PK, ZSTANZAID, ZTEXT, ZMESSAGEDATE, ZISFROMME, ZMESSAGETYPE, ZCHATSESSION) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [104, "stanza-empty", "", unixToCoreData(T_NEW), 1, 0, 1],
  );
  // 5: unknown session
  db.run(
    `INSERT INTO ZWAMESSAGE (Z_PK, ZSTANZAID, ZTEXT, ZMESSAGEDATE, ZISFROMME, ZMESSAGETYPE, ZCHATSESSION) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [105, "stanza-unknown", "orphan msg", unixToCoreData(T_MID + 1), 0, 0, 3],
  );

  db.close();
});

afterAll(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});

describe("whatsapp source (fixture)", () => {
  test("fetchNew returns all non-empty messages with correct shape and order", async () => {
    const source = createWhatsappSource({
      dbPath,
      skipCopy: true,
      now: () => NOW_UNIX,
    });
    const items = await source.fetchNew(new MockSyncState());

    // 4 non-empty messages should come back (empty-text one is filtered out).
    expect(items).toHaveLength(4);

    // ZMESSAGEDATE DESC → newest first
    // Order: T_NEW (103), T_MID+1 (105), T_MID (102), T_OLD (101)
    expect(items[0]!.externalId).toBe("whatsapp-103");
    expect(items[0]!.content).toBe("latest reply");
    expect(items[0]!.createdAt).toBe(T_NEW);
    expect(items[0]!.source).toBe("whatsapp");
    expect(items[0]!.metadata.isFromMe).toBe(false);
    expect(items[0]!.metadata.isGroup).toBe(false);
    expect(items[0]!.metadata.contactName).toBe("Alice");
    expect(items[0]!.metadata.conversationId).toBe("15551234567@s.whatsapp.net");

    expect(items[1]!.externalId).toBe("whatsapp-stanza-unknown");
    expect(items[1]!.metadata.contactName).toBe("Unknown");
    expect(items[1]!.metadata.conversationId).toBe("unknown");
    expect(items[1]!.metadata.isGroup).toBe(false);

    expect(items[2]!.externalId).toBe("whatsapp-stanza-mid");
    expect(items[2]!.content).toBe("i'm in the group");
    expect(items[2]!.createdAt).toBe(T_MID);
    expect(items[2]!.metadata.isFromMe).toBe(true);
    expect(items[2]!.metadata.isGroup).toBe(true);
    expect(items[2]!.metadata.contactName).toBe("Weekend Crew");
    expect(items[2]!.metadata.conversationId).toBe("1234567890-1600000000@g.us");

    expect(items[3]!.externalId).toBe("whatsapp-stanza-old");
    expect(items[3]!.createdAt).toBe(T_OLD);
  });

  test("markSynced cutoff filters messages at or before last sync", async () => {
    const source = createWhatsappSource({
      dbPath,
      skipCopy: true,
      now: () => NOW_UNIX,
    });
    const state = new MockSyncState();
    state.markSynced("whatsapp", T_MID);

    const items = await source.fetchNew(state);
    // Strictly newer than T_MID: T_NEW (103) and T_MID+1 (105).
    expect(items).toHaveLength(2);
    const ids = items.map((i) => i.externalId).sort();
    expect(ids).toEqual(["whatsapp-103", "whatsapp-stanza-unknown"]);
  });

  test("markSynced at NOW returns nothing", async () => {
    const source = createWhatsappSource({
      dbPath,
      skipCopy: true,
      now: () => NOW_UNIX,
    });
    const state = new MockSyncState();
    state.markSynced("whatsapp", NOW_UNIX);
    const items = await source.fetchNew(state);
    expect(items).toHaveLength(0);
  });

  test("defaultDays cutoff uses injected clock", async () => {
    const source = createWhatsappSource({
      dbPath,
      skipCopy: true,
      now: () => NOW_UNIX,
    });
    // defaultDays=3 → cutoff = NOW - 3d. Only T_NEW (1d ago) qualifies.
    const items = await source.fetchNew(new MockSyncState(), { defaultDays: 3 });
    expect(items).toHaveLength(1);
    expect(items[0]!.externalId).toBe("whatsapp-103");
  });

  test("limit option is respected", async () => {
    const source = createWhatsappSource({
      dbPath,
      skipCopy: true,
      now: () => NOW_UNIX,
    });
    const items = await source.fetchNew(new MockSyncState(), { limit: 2 });
    expect(items).toHaveLength(2);
    expect(items[0]!.externalId).toBe("whatsapp-103");
    expect(items[1]!.externalId).toBe("whatsapp-stanza-unknown");
  });

  test("production export is still usable", async () => {
    expect(whatsapp.name).toBe("whatsapp");
    expect(typeof whatsapp.fetchNew).toBe("function");
  });

  test.skipIf(!LIVE)("LIVE: reads from real WhatsApp ChatStorage.sqlite", async () => {
    const items = await whatsapp.fetchNew(new MockSyncState(), { defaultDays: 7, limit: 10 });
    for (const item of items) validateItem(item, "whatsapp", /^whatsapp-/);
  }, 60_000);
});
