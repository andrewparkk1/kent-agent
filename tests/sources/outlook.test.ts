import { test, expect, describe, beforeAll, afterAll } from "bun:test";
import { Database } from "bun:sqlite";
import { join } from "path";
import { tmpdir } from "os";
import { mkdtempSync, rmSync } from "fs";
import { MockSyncState, validateItem, LIVE } from "./_helpers.ts";
import { createOutlookSource, outlook } from "@daemon/sources/outlook.ts";

// ─── SQLite fixture ───────────────────────────────────────────────────────

let tmpDir: string;
let fixtureDb: string;

// Cocoa epoch: 2001-01-01T00:00:00Z = 978307200 unix seconds
// Source parses small numbers (< 1e9) as Cocoa seconds.
const COCOA_EPOCH = 978307200;

// Unix seconds for our test messages
const UNIX_MSG1 = Math.floor(Date.parse("2023-11-14T10:00:00Z") / 1000);
const UNIX_MSG2 = Math.floor(Date.parse("2023-11-13T10:00:00Z") / 1000);
const UNIX_MSG3 = Math.floor(Date.parse("2023-11-12T10:00:00Z") / 1000);

function buildFixture(): string {
  tmpDir = mkdtempSync(join(tmpdir(), "kent-outlook-test-"));
  const dbPath = join(tmpDir, "Outlook.sqlite");
  const db = new Database(dbPath, { create: true });

  // Folder table
  db.run(`CREATE TABLE Folder (
    FolderId INTEGER PRIMARY KEY,
    Name TEXT
  )`);
  db.run(`INSERT INTO Folder (FolderId, Name) VALUES (1, 'Inbox'), (2, 'Sent')`);

  // Mail table with schema that discoverSchema can find
  db.run(`CREATE TABLE Mail (
    MessageId TEXT PRIMARY KEY,
    Subject TEXT,
    Sender TEXT,
    Preview TEXT,
    DateReceived INTEGER,
    HasAttachments INTEGER,
    FolderId INTEGER,
    IsRead INTEGER,
    Recipients TEXT
  )`);

  const insert = db.prepare(`INSERT INTO Mail
    (MessageId, Subject, Sender, Preview, DateReceived, HasAttachments, FolderId, IsRead, Recipients)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);

  // Store as Cocoa seconds (unix - COCOA_EPOCH), so source parses them back correctly
  insert.run("msg-001", "Hello Andrew", "bob@example.com", "Just saying hi", UNIX_MSG1 - COCOA_EPOCH, 0, 1, 1, "alice@example.com");
  insert.run("msg-002", "Invoice #42", "billing@vendor.com", "Attached invoice", UNIX_MSG2 - COCOA_EPOCH, 1, 1, 0, "alice@example.com");
  insert.run("msg-003", "Lunch?", "friend@example.com", "Want to grab food?", UNIX_MSG3 - COCOA_EPOCH, 0, 2, 1, "alice@example.com");

  db.close();
  return dbPath;
}

beforeAll(() => {
  fixtureDb = buildFixture();
});

afterAll(() => {
  if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
});

// ─── Graph API fetcher ────────────────────────────────────────────────────

const GRAPH_MESSAGES = [
  {
    id: "g-msg-1",
    subject: "Quarterly report",
    from: { emailAddress: { name: "CEO", address: "ceo@company.com" } },
    toRecipients: [{ emailAddress: { name: "Alice", address: "alice@company.com" } }],
    receivedDateTime: "2023-11-14T14:00:00Z",
    bodyPreview: "Q3 results attached",
    hasAttachments: true,
    isRead: false,
    parentFolderId: "folder-inbox",
  },
  {
    id: "g-msg-2",
    subject: "Welcome",
    from: { emailAddress: { address: "noreply@svc.com" } },
    toRecipients: [{ emailAddress: { address: "alice@company.com" } }],
    receivedDateTime: "2023-11-13T08:00:00Z",
    bodyPreview: "Welcome to our service",
    hasAttachments: false,
    isRead: true,
    parentFolderId: "folder-inbox",
  },
  {
    id: "g-msg-3",
    subject: "Re: meeting",
    from: { emailAddress: { name: "Bob Jones" } },
    toRecipients: [],
    receivedDateTime: "2023-11-12T08:00:00Z",
    bodyPreview: "Sounds good",
    hasAttachments: false,
    isRead: true,
    parentFolderId: "folder-inbox",
  },
];

function makeGraphFetcher(): typeof fetch {
  return (async (input: any): Promise<Response> => {
    const url = typeof input === "string" ? input : input.url ?? input.toString();
    if (url.startsWith("https://graph.microsoft.com/v1.0/me/messages")) {
      return new Response(JSON.stringify({ value: GRAPH_MESSAGES }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response("", { status: 404 });
  }) as unknown as typeof fetch;
}

// ─── Tests ────────────────────────────────────────────────────────────────

describe("outlook source (mocked)", () => {
  test("exported outlook still conforms to Source interface", () => {
    expect(outlook.name).toBe("outlook");
    expect(typeof outlook.fetchNew).toBe("function");
  });

  test("returns empty array when no db, no token", async () => {
    const src = createOutlookSource({
      dbPath: "/nonexistent/path/Outlook.sqlite",
      token: null,
    });
    const items = await src.fetchNew(new MockSyncState());
    expect(items).toEqual([]);
  });

  describe("local sqlite path", () => {
    test("parses messages from fixture sqlite with discovered schema", async () => {
      const src = createOutlookSource({ dbPath: fixtureDb });
      const items = await src.fetchNew(new MockSyncState());

      for (const item of items) validateItem(item, "outlook", /^outlook-/);
      expect(items.length).toBe(3);

      const m1 = items.find((i) => i.externalId === "outlook-msg-001")!;
      expect(m1).toBeDefined();
      expect(m1.content).toBe("Hello Andrew\nFrom: bob@example.com\nJust saying hi");
      expect(m1.metadata.subject).toBe("Hello Andrew");
      expect(m1.metadata.from).toBe("bob@example.com");
      expect(m1.metadata.to).toBe("alice@example.com");
      expect(m1.metadata.hasAttachments).toBe(false);
      expect(m1.metadata.isRead).toBe(true);
      expect(m1.metadata.folder).toBe("Inbox");
      expect(m1.createdAt).toBe(UNIX_MSG1);

      const m2 = items.find((i) => i.externalId === "outlook-msg-002")!;
      expect(m2).toBeDefined();
      expect(m2.metadata.hasAttachments).toBe(true);
      expect(m2.metadata.isRead).toBe(false);
      expect(m2.metadata.folder).toBe("Inbox");

      const m3 = items.find((i) => i.externalId === "outlook-msg-003")!;
      expect(m3).toBeDefined();
      expect(m3.metadata.folder).toBe("Sent");
    });

    test("filters sqlite rows older than lastSync", async () => {
      const src = createOutlookSource({ dbPath: fixtureDb });
      const state = new MockSyncState();
      // cutoff after msg-002 (Nov 13) keeps only msg-001 (Nov 14)
      state.resetSync("outlook", UNIX_MSG2 + 1);
      const items = await src.fetchNew(state);
      expect(items.length).toBe(1);
      expect(items[0]!.externalId).toBe("outlook-msg-001");
    });
  });

  describe("graph API path", () => {
    test("falls back to Graph API when no local db", async () => {
      const src = createOutlookSource({
        dbPath: "/nonexistent/fake.sqlite",
        fetcher: makeGraphFetcher(),
        token: "graph-token",
      });
      const items = await src.fetchNew(new MockSyncState());

      for (const item of items) validateItem(item, "outlook", /^outlook-/);
      expect(items.length).toBe(3);

      const g1 = items.find((i) => i.externalId === "outlook-g-msg-1")!;
      expect(g1).toBeDefined();
      expect(g1.content).toBe("Quarterly report\nFrom: CEO\nQ3 results attached");
      expect(g1.metadata.subject).toBe("Quarterly report");
      expect(g1.metadata.from).toBe("CEO");
      expect(g1.metadata.to).toBe("Alice");
      expect(g1.metadata.hasAttachments).toBe(true);
      expect(g1.metadata.isRead).toBe(false);
      expect(g1.metadata.folder).toBe("folder-inbox");
      expect(g1.createdAt).toBe(Math.floor(Date.parse("2023-11-14T14:00:00Z") / 1000));

      const g2 = items.find((i) => i.externalId === "outlook-g-msg-2")!;
      expect(g2).toBeDefined();
      // sender name missing → falls back to address
      expect(g2.metadata.from).toBe("noreply@svc.com");
      expect(g2.metadata.to).toBe("alice@company.com");

      const g3 = items.find((i) => i.externalId === "outlook-g-msg-3")!;
      expect(g3).toBeDefined();
      expect(g3.metadata.from).toBe("Bob Jones");
      // no recipients → to is undefined
      expect(g3.metadata.to).toBeUndefined();
    });
  });

  test.skipIf(!LIVE)("LIVE: pulls real Outlook messages", async () => {
    const items = await outlook.fetchNew(new MockSyncState(), { defaultDays: 1, limit: 5 });
    for (const item of items) validateItem(item, "outlook", /^outlook-/);
  }, 120_000);
});
