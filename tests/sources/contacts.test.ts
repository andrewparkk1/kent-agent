import { test, expect, describe, beforeAll, afterAll } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { MockSyncState, validateItem, LIVE } from "./_helpers.ts";
import { createContactsSource, contacts } from "@daemon/sources/contacts.ts";

const CORE_DATA_EPOCH_OFFSET = 978307200;
const unixToCore = (unix: number) => unix - CORE_DATA_EPOCH_OFFSET;

let tmpDir: string;
let dbPath: string;

const BASE_UNIX = Math.floor(new Date("2024-06-15T12:00:00Z").getTime() / 1000);

function createAddressBookDb(path: string) {
  const db = new Database(path);
  db.exec(`
    CREATE TABLE ZABCDRECORD (
      Z_PK INTEGER PRIMARY KEY AUTOINCREMENT,
      ZFIRSTNAME TEXT,
      ZLASTNAME TEXT,
      ZNICKNAME TEXT,
      ZORGANIZATION TEXT,
      ZJOBTITLE TEXT,
      ZBIRTHDAY REAL,
      ZNOTE TEXT,
      ZCREATIONDATE REAL NOT NULL,
      ZMODIFICATIONDATE REAL NOT NULL
    );
    CREATE TABLE ZABCDPHONENUMBER (
      Z_PK INTEGER PRIMARY KEY AUTOINCREMENT,
      ZOWNER INTEGER,
      ZFULLNUMBER TEXT,
      ZLABEL TEXT
    );
    CREATE TABLE ZABCDEMAILADDRESS (
      Z_PK INTEGER PRIMARY KEY AUTOINCREMENT,
      ZOWNER INTEGER,
      ZADDRESS TEXT,
      ZLABEL TEXT
    );
    CREATE TABLE ZABCDPOSTALADDRESS (
      Z_PK INTEGER PRIMARY KEY AUTOINCREMENT,
      ZOWNER INTEGER,
      ZSTREET TEXT,
      ZCITY TEXT,
      ZSTATE TEXT,
      ZZIPCODE TEXT,
      ZCOUNTRYNAME TEXT,
      ZLABEL TEXT
    );
  `);

  const insertContact = db.prepare(
    `INSERT INTO ZABCDRECORD (ZFIRSTNAME, ZLASTNAME, ZNICKNAME, ZORGANIZATION, ZJOBTITLE, ZBIRTHDAY, ZNOTE, ZCREATIONDATE, ZMODIFICATIONDATE) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const insertPhone = db.prepare(
    `INSERT INTO ZABCDPHONENUMBER (ZOWNER, ZFULLNUMBER, ZLABEL) VALUES (?, ?, ?)`
  );
  const insertEmail = db.prepare(
    `INSERT INTO ZABCDEMAILADDRESS (ZOWNER, ZADDRESS, ZLABEL) VALUES (?, ?, ?)`
  );

  // Contact 1: Alice — phone only
  insertContact.run(
    "Alice", "Anderson", null, null, null, null, null,
    unixToCore(BASE_UNIX - 3600), unixToCore(BASE_UNIX - 3600)
  );
  insertPhone.run(1, "+15551112222", "_$!<Mobile>!$_");

  // Contact 2: Bob — email only
  insertContact.run(
    "Bob", "Brown", null, null, null, null, null,
    unixToCore(BASE_UNIX - 1800), unixToCore(BASE_UNIX - 1800)
  );
  insertEmail.run(2, "bob@example.com", "_$!<Work>!$_");

  // Contact 3: Carol — phone + email
  insertContact.run(
    "Carol", "Clark", null, null, null, null, null,
    unixToCore(BASE_UNIX - 600), unixToCore(BASE_UNIX - 600)
  );
  insertPhone.run(3, "+15553334444", "_$!<Home>!$_");
  insertEmail.run(3, "carol@example.com", "_$!<Home>!$_");

  // Contact 4: Dan — org + nickname + note + jobTitle
  insertContact.run(
    "Dan", "Davis", "Danny", "Acme Corp", "CTO", null, "Met at conference",
    unixToCore(BASE_UNIX), unixToCore(BASE_UNIX)
  );

  db.close();
}

beforeAll(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "kent-contacts-test-"));
  dbPath = join(tmpDir, "AddressBook-v22.abcddb");
  createAddressBookDb(dbPath);
});

afterAll(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

describe("contacts source", () => {
  test("exports conform to Source interface", () => {
    expect(contacts.name).toBe("contacts");
    expect(typeof contacts.fetchNew).toBe("function");
    expect(typeof createContactsSource).toBe("function");
  });

  test("returns all 4 contacts with correct content, metadata, and externalId", async () => {
    const src = createContactsSource({ abPaths: [dbPath] });
    const items = await src.fetchNew(new MockSyncState());

    expect(items.length).toBe(4);
    for (const item of items) validateItem(item, "contacts", /^contacts-\d+$/);

    const byId: Record<string, typeof items[number]> = {};
    for (const it of items) byId[it.externalId] = it;

    // Alice — phone only
    const alice = byId["contacts-1"];
    expect(alice).toBeDefined();
    expect(alice!.metadata.firstName).toBe("Alice");
    expect(alice!.metadata.lastName).toBe("Anderson");
    expect(alice!.metadata.phones).toEqual([{ number: "+15551112222", label: "Mobile" }]);
    expect(alice!.metadata.emails).toEqual([]);
    expect(alice!.content).toContain("Name: Alice Anderson");
    expect(alice!.content).toContain("Phone (Mobile): +15551112222");
    expect(alice!.createdAt).toBe(BASE_UNIX - 3600);

    // Bob — email only
    const bob = byId["contacts-2"];
    expect(bob).toBeDefined();
    expect(bob!.metadata.firstName).toBe("Bob");
    expect(bob!.metadata.phones).toEqual([]);
    expect(bob!.metadata.emails).toEqual([{ address: "bob@example.com", label: "Work" }]);
    expect(bob!.content).toContain("Name: Bob Brown");
    expect(bob!.content).toContain("Email (Work): bob@example.com");
    expect(bob!.createdAt).toBe(BASE_UNIX - 1800);

    // Carol — phone + email
    const carol = byId["contacts-3"];
    expect(carol).toBeDefined();
    expect(carol!.metadata.phones).toEqual([{ number: "+15553334444", label: "Home" }]);
    expect(carol!.metadata.emails).toEqual([{ address: "carol@example.com", label: "Home" }]);
    expect(carol!.content).toContain("Name: Carol Clark");
    expect(carol!.content).toContain("Phone (Home): +15553334444");
    expect(carol!.content).toContain("Email (Home): carol@example.com");

    // Dan — org + nickname + note + jobTitle
    const dan = byId["contacts-4"];
    expect(dan).toBeDefined();
    expect(dan!.metadata.nickname).toBe("Danny");
    expect(dan!.metadata.org).toBe("Acme Corp");
    expect(dan!.metadata.jobTitle).toBe("CTO");
    expect(dan!.content).toContain("Name: Dan Davis");
    expect(dan!.content).toContain("Nickname: Danny");
    expect(dan!.content).toContain("Organization: Acme Corp");
    expect(dan!.content).toContain("Job Title: CTO");
    expect(dan!.content).toContain("Note: Met at conference");
    expect(dan!.createdAt).toBe(BASE_UNIX);
  });

  test("respects sync cutoff — lastSync filters older contacts", async () => {
    const src = createContactsSource({ abPaths: [dbPath] });
    const state = new MockSyncState();
    state.resetSync("contacts", BASE_UNIX - 300);

    const items = await src.fetchNew(state);
    expect(items.length).toBe(1);
    expect(items[0]!.externalId).toBe("contacts-4");
    expect(items[0]!.metadata.firstName).toBe("Dan");
  });

  test("respects options.limit", async () => {
    const src = createContactsSource({ abPaths: [dbPath] });
    const items = await src.fetchNew(new MockSyncState(), { limit: 2 });
    expect(items.length).toBe(2);
  });

  test("deduplicates contacts across multiple databases", async () => {
    const src = createContactsSource({ abPaths: [dbPath, dbPath] });
    const items = await src.fetchNew(new MockSyncState());
    expect(items.length).toBe(4);
  });

  test.skipIf(!LIVE)("LIVE: reads from real AddressBook sqlite", async () => {
    const items = await contacts.fetchNew(new MockSyncState(), { limit: 10 });
    for (const item of items) validateItem(item, "contacts", /^contacts-/);
  }, 60_000);
});
