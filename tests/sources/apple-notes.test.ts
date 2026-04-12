import { test, expect, describe, beforeAll, afterAll } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { MockSyncState, validateItem, LIVE } from "./_helpers.ts";
import { createAppleNotesSource, appleNotes } from "@daemon/sources/apple-notes.ts";

const CORE_DATA_EPOCH_OFFSET = 978307200;
const unixToCore = (unix: number) => unix - CORE_DATA_EPOCH_OFFSET;

let tmpDir: string;
let dbPath: string;

const BASE_UNIX = Math.floor(new Date("2024-06-15T12:00:00Z").getTime() / 1000);

/**
 * Build a fixture NoteStore.sqlite. In the real Apple Notes database, both
 * notes and folders live in ZICCLOUDSYNCINGOBJECT — we replicate the subset
 * of columns the source actually SELECTs.
 *
 * The source's body extractor tries gunzip first and falls back to raw UTF-8,
 * so we can store plain-text bytes directly in ZDATA for testing.
 */
function createNoteStoreDb(path: string) {
  const db = new Database(path);
  db.exec(`
    CREATE TABLE ZICCLOUDSYNCINGOBJECT (
      Z_PK INTEGER PRIMARY KEY AUTOINCREMENT,
      ZTITLE1 TEXT,
      ZTITLE2 TEXT,
      ZSNIPPET TEXT,
      ZMODIFICATIONDATE1 REAL,
      ZCREATIONDATE3 REAL,
      ZFOLDER INTEGER,
      ZMARKEDFORDELETION INTEGER,
      ZISPASSWORDPROTECTED INTEGER
    );
    CREATE TABLE ZICNOTEDATA (
      Z_PK INTEGER PRIMARY KEY AUTOINCREMENT,
      ZNOTE INTEGER,
      ZDATA BLOB
    );
  `);

  // Folder rows: Z_PK=100 "Work", Z_PK=101 "Notes" (default), Z_PK=102 "Personal"
  const insertFolder = db.prepare(
    `INSERT INTO ZICCLOUDSYNCINGOBJECT (Z_PK, ZTITLE1, ZTITLE2, ZMODIFICATIONDATE1, ZCREATIONDATE3) VALUES (?, NULL, ?, NULL, NULL)`
  );
  insertFolder.run(100, "Work");
  insertFolder.run(101, "Notes");
  insertFolder.run(102, "Personal");

  const insertNote = db.prepare(
    `INSERT INTO ZICCLOUDSYNCINGOBJECT (Z_PK, ZTITLE1, ZSNIPPET, ZMODIFICATIONDATE1, ZCREATIONDATE3, ZFOLDER, ZMARKEDFORDELETION, ZISPASSWORDPROTECTED) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const insertData = db.prepare(
    `INSERT INTO ZICNOTEDATA (ZNOTE, ZDATA) VALUES (?, ?)`
  );

  // Note 1 — Work folder, has body
  insertNote.run(
    1, "Meeting Notes", "quick snippet",
    unixToCore(BASE_UNIX - 3600), unixToCore(BASE_UNIX - 7200),
    100, 0, 0
  );
  insertData.run(1, Buffer.from("Discuss roadmap and next steps", "utf-8"));

  // Note 2 — default "Notes" folder, body only
  insertNote.run(
    2, "Grocery List", null,
    unixToCore(BASE_UNIX - 1800), unixToCore(BASE_UNIX - 1800),
    101, 0, 0
  );
  insertData.run(2, Buffer.from("Eggs\nMilk\nBread", "utf-8"));

  // Note 3 — Personal folder, snippet-only (no body data row)
  insertNote.run(
    3, "Birthday ideas", "Cake and balloons",
    unixToCore(BASE_UNIX - 600), unixToCore(BASE_UNIX - 600),
    102, 0, 0
  );

  // Note 4 — newest
  insertNote.run(
    4, "Latest thought", "fresh",
    unixToCore(BASE_UNIX), unixToCore(BASE_UNIX),
    101, 0, 0
  );
  insertData.run(4, Buffer.from("Just jotted this down", "utf-8"));

  // Filtered: marked for deletion
  insertNote.run(
    5, "Trashed note", "deleted content",
    unixToCore(BASE_UNIX), unixToCore(BASE_UNIX),
    101, 1, 0
  );
  insertData.run(5, Buffer.from("bye", "utf-8"));

  // Filtered: password protected
  insertNote.run(
    6, "Locked note", "secret",
    unixToCore(BASE_UNIX), unixToCore(BASE_UNIX),
    101, 0, 1
  );
  insertData.run(6, Buffer.from("top secret", "utf-8"));

  // Filtered: null title
  insertNote.run(
    7, null, "no title",
    unixToCore(BASE_UNIX), unixToCore(BASE_UNIX),
    101, 0, 0
  );

  db.close();
}

beforeAll(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "kent-notes-test-"));
  dbPath = join(tmpDir, "NoteStore.sqlite");
  createNoteStoreDb(dbPath);
});

afterAll(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

describe("apple-notes source (SQLite code path)", () => {
  test("exports conform to Source interface", () => {
    expect(appleNotes.name).toBe("apple-notes");
    expect(typeof appleNotes.fetchNew).toBe("function");
    expect(typeof createAppleNotesSource).toBe("function");
  });

  test("returns 4 visible notes with correct content, metadata, and externalId", async () => {
    const src = createAppleNotesSource({ dbPath });
    const items = await src.fetchNew(new MockSyncState());

    expect(items.length).toBe(4);
    for (const item of items) validateItem(item, "apple-notes", /^apple-notes-\d+$/);

    const byId: Record<string, typeof items[number]> = {};
    for (const it of items) byId[it.externalId] = it;

    // Note 1 — Meeting Notes in Work folder
    const n1 = byId["apple-notes-1"];
    expect(n1).toBeDefined();
    expect(n1!.metadata.title).toBe("Meeting Notes");
    expect(n1!.metadata.folder).toBe("Work");
    expect(n1!.metadata.hasFormatting).toBe(false);
    expect(n1!.content).toContain("# Meeting Notes");
    expect(n1!.content).toContain("Folder: Work");
    expect(n1!.content).toContain("Discuss roadmap and next steps");
    expect(n1!.createdAt).toBe(BASE_UNIX - 7200);
    expect(n1!.metadata.modifiedAt).toBe(BASE_UNIX - 3600);

    // Note 2 — default "Notes" folder (no "Folder:" line)
    const n2 = byId["apple-notes-2"];
    expect(n2).toBeDefined();
    expect(n2!.metadata.title).toBe("Grocery List");
    expect(n2!.metadata.folder).toBe("Notes");
    expect(n2!.content).toContain("# Grocery List");
    expect(n2!.content).not.toContain("Folder:");
    expect(n2!.content).toContain("Eggs");
    expect(n2!.content).toContain("Milk");
    expect(n2!.content).toContain("Bread");
    expect(n2!.createdAt).toBe(BASE_UNIX - 1800);

    // Note 3 — no body data row -> snippet fallback
    const n3 = byId["apple-notes-3"];
    expect(n3).toBeDefined();
    expect(n3!.metadata.title).toBe("Birthday ideas");
    expect(n3!.metadata.folder).toBe("Personal");
    expect(n3!.content).toContain("# Birthday ideas");
    expect(n3!.content).toContain("Folder: Personal");
    expect(n3!.content).toContain("Cake and balloons");

    // Note 4 — newest
    const n4 = byId["apple-notes-4"];
    expect(n4).toBeDefined();
    expect(n4!.metadata.title).toBe("Latest thought");
    expect(n4!.content).toContain("Just jotted this down");
    expect(n4!.createdAt).toBe(BASE_UNIX);

    // Filtered out — deleted, locked, null title
    expect(byId["apple-notes-5"]).toBeUndefined();
    expect(byId["apple-notes-6"]).toBeUndefined();
    expect(byId["apple-notes-7"]).toBeUndefined();
  });

  test("respects sync cutoff — lastSync filters older notes", async () => {
    const src = createAppleNotesSource({ dbPath });
    const state = new MockSyncState();
    // Cutoff between Note 3 (BASE-600) and Note 4 (BASE) — only Note 4 newer
    state.resetSync("apple-notes", BASE_UNIX - 300);

    const items = await src.fetchNew(state);
    expect(items.length).toBe(1);
    expect(items[0]!.externalId).toBe("apple-notes-4");
    expect(items[0]!.metadata.title).toBe("Latest thought");
  });

  test("results ordered by modification date desc", async () => {
    const src = createAppleNotesSource({ dbPath });
    const items = await src.fetchNew(new MockSyncState());
    const modifiedTimes = items.map((i) => i.metadata.modifiedAt as number);
    for (let i = 0; i < modifiedTimes.length - 1; i++) {
      expect(modifiedTimes[i]!).toBeGreaterThanOrEqual(modifiedTimes[i + 1]!);
    }
  });

  test("wordCount metadata reflects extracted text length", async () => {
    const src = createAppleNotesSource({ dbPath });
    const items = await src.fetchNew(new MockSyncState());
    const n1 = items.find((i) => i.externalId === "apple-notes-1")!;
    // "Discuss roadmap and next steps" => 5 words
    expect(n1.metadata.wordCount).toBe(5);
  });

  test.skipIf(!LIVE)("LIVE: reads from real NoteStore.sqlite", async () => {
    const items = await appleNotes.fetchNew(new MockSyncState(), { defaultDays: 365, limit: 10 });
    for (const item of items) validateItem(item, "apple-notes", /^(apple-notes-|x-coredata:)/);
  }, 60_000);
});
