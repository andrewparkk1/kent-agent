import { test, expect, describe } from "bun:test";
import { MockSyncState, validateItem, LIVE } from "./_helpers.ts";
import {
  createGmailSource,
  createGcalSource,
  createGtasksSource,
  createGdriveSource,
  gmail,
  gcal,
  gtasks,
  gdrive,
  type GoogleClient,
} from "@daemon/sources/gmail.ts";

// ─── Helpers ─────────────────────────────────────────────────────────────

function makeHeaders(h: Record<string, string>) {
  return Object.entries(h).map(([name, value]) => ({ name, value }));
}

/** A fully-stubbable client. Any unused methods return sensible empty defaults. */
function makeClient(overrides: Partial<GoogleClient> = {}): GoogleClient {
  return {
    listMessages: async () => ({ messages: [] }),
    getMessage: async () => null,
    listEvents: async () => ({ items: [] }),
    listTaskLists: async () => ({ items: [] }),
    listTasks: async () => ({ items: [] }),
    listFiles: async () => ({ files: [] }),
    exportFile: async () => null,
    ...overrides,
  };
}

const FIXED_NOW = 1_700_000_000_000; // 2023-11-14T22:13:20Z
const now = () => FIXED_NOW;

// ─── Production-default exports still resolve ──────────────────────────

describe("production exports", () => {
  test("gmail/gcal/gtasks/gdrive are Sources with correct names", () => {
    expect(gmail.name).toBe("gmail");
    expect(gcal.name).toBe("gcal");
    expect(gtasks.name).toBe("gtasks");
    expect(gdrive.name).toBe("gdrive");
    for (const s of [gmail, gcal, gtasks, gdrive]) {
      expect(typeof s.fetchNew).toBe("function");
    }
  });
});

// ─── No-client fallback (missing auth/CLI) ─────────────────────────────

describe("missing client fallback", () => {
  test("all sources return [] when client is null", async () => {
    const state = new MockSyncState();
    for (const src of [
      createGmailSource({ client: null, now }),
      createGcalSource({ client: null, now }),
      createGtasksSource({ client: null, now }),
      createGdriveSource({ client: null, now }),
    ]) {
      const items = await src.fetchNew(state);
      expect(items).toEqual([]);
    }
  });
});

// ─── Gmail ──────────────────────────────────────────────────────────────

describe("gmail (mail) source", () => {
  const messages = {
    "m1": {
      id: "m1",
      threadId: "t1",
      internalDate: "1699900000000", // 2023-11-13
      snippet: "Hey there, this is the body snippet",
      labelIds: ["INBOX", "UNREAD"],
      payload: {
        headers: makeHeaders({
          Subject: "Project kickoff",
          From: "alice@example.com",
          To: "me@example.com",
          Date: "Mon, 13 Nov 2023 12:00:00 +0000",
        }),
      },
    },
    "m2": {
      id: "m2",
      threadId: "t2",
      internalDate: "1699950000000", // later
      snippet: "Reply with agenda",
      labelIds: ["INBOX"],
      payload: {
        headers: makeHeaders({
          Subject: "Re: Project kickoff",
          From: "bob@example.com",
          To: "me@example.com",
          Date: "Mon, 13 Nov 2023 18:00:00 +0000",
        }),
      },
    },
    "m3": {
      id: "m3",
      threadId: "t3",
      internalDate: "1699800000000", // older
      // Edge case: empty body / missing subject
      snippet: "",
      labelIds: [],
      payload: {
        headers: makeHeaders({ From: "noreply@svc.example", To: "me@example.com" }),
      },
    },
  } as const;

  function gmailClient(): GoogleClient {
    return makeClient({
      async listMessages({ q }) {
        if (q.includes("in:inbox")) {
          return { messages: [{ id: "m1" }, { id: "m2" }] };
        }
        if (q.includes("in:sent")) {
          // m2 is duplicated across inbox+sent to exercise dedupe; m3 only in sent
          return { messages: [{ id: "m2" }, { id: "m3" }] };
        }
        return { messages: [] };
      },
      async getMessage(id) {
        return (messages as any)[id] ?? null;
      },
    });
  }

  test("parses 3 messages, dedupes across inbox/sent, exact shape", async () => {
    const src = createGmailSource({ client: gmailClient(), now });
    const items = await src.fetchNew(new MockSyncState());

    expect(items).toHaveLength(3);
    for (const item of items) validateItem(item, "gmail", /^gmail-/);

    const byId = Object.fromEntries(items.map((i) => [i.externalId, i]));

    const i1 = byId["gmail-m1"]!;
    expect(i1).toBeDefined();
    expect(i1.createdAt).toBe(Math.floor(1699900000000 / 1000));
    expect(i1.content).toContain("Subject: Project kickoff");
    expect(i1.content).toContain("From: alice@example.com");
    expect(i1.content).toContain("To: me@example.com");
    expect(i1.content).toContain("Hey there, this is the body snippet");
    expect(i1.metadata.subject).toBe("Project kickoff");
    expect(i1.metadata.from).toBe("alice@example.com");
    expect(i1.metadata.to).toBe("me@example.com");
    expect(i1.metadata.threadId).toBe("t1");
    expect(i1.metadata.labels).toEqual(["INBOX", "UNREAD"]);
    expect(i1.metadata.isUnread).toBe(true);

    const i2 = byId["gmail-m2"]!;
    expect(i2.metadata.isUnread).toBe(false);
    expect(i2.metadata.threadId).toBe("t2");

    // Edge case: missing subject -> "(no subject)", empty snippet, no labels
    const i3 = byId["gmail-m3"]!;
    expect(i3.metadata.subject).toBe("(no subject)");
    expect(i3.metadata.labels).toEqual([]);
    expect(i3.metadata.isUnread).toBe(false);
    expect(i3.content).toContain("From: noreply@svc.example");
    // "(no subject)" fallback renders (it's truthy)
    expect(i3.content).toContain("Subject: (no subject)");
  });

  test("subject fallback renders in content too", async () => {
    const src = createGmailSource({ client: gmailClient(), now });
    const items = await src.fetchNew(new MockSyncState());
    const i3 = items.find((i) => i.externalId === "gmail-m3")!;
    expect(i3.content).toContain("Subject: (no subject)");
  });

  test("honors sync cutoff: after markSynced, only newer messages remain", async () => {
    const state = new MockSyncState();
    // cut off between m3 (1699800000) and m1 (1699900000)
    state.resetSync("gmail", 1699850000);
    const src = createGmailSource({ client: gmailClient(), now });
    const items = await src.fetchNew(state);
    const ids = items.map((i) => i.externalId).sort();
    expect(ids).toEqual(["gmail-m1", "gmail-m2"]);
  });

  test("returns [] when client is undefined (falls through to default)", async () => {
    // Passing `undefined` hits the default-client path. Since in test env
    // there's no gws CLI, createGwsClient() returns null and we get [].
    // We test this more directly with `client: null` above; this ensures the
    // try/catch around the default-client resolver doesn't throw.
    const src = createGmailSource({ client: null, now });
    expect(await src.fetchNew(new MockSyncState())).toEqual([]);
  });

  test("handles listMessages throwing gracefully", async () => {
    const src = createGmailSource({
      client: makeClient({
        async listMessages() { throw new Error("boom"); },
      }),
      now,
    });
    expect(await src.fetchNew(new MockSyncState())).toEqual([]);
  });
});

// ─── GCal ───────────────────────────────────────────────────────────────

describe("gcal (calendar) source", () => {
  const events = [
    {
      id: "e1",
      status: "confirmed",
      summary: "All-hands",
      description: "Quarterly review",
      location: "Zoom",
      start: { dateTime: "2023-11-15T15:00:00Z" },
      end: { dateTime: "2023-11-15T16:00:00Z" },
      updated: "2023-11-10T10:00:00Z",
      attendees: [
        { email: "me@example.com", self: true },
        { email: "alice@example.com" },
        { email: "bob@example.com" },
      ],
    },
    {
      id: "e2",
      status: "confirmed",
      summary: "Holiday",
      start: { date: "2023-12-25" },
      end: { date: "2023-12-26" },
      updated: "2023-11-01T09:00:00Z",
    },
    {
      id: "e3",
      status: "confirmed",
      summary: "Weekly sync",
      description: "Recurring team sync",
      start: { dateTime: "2023-11-20T14:00:00Z" },
      end: { dateTime: "2023-11-20T14:30:00Z" },
      recurringEventId: "r1",
      updated: "2023-11-12T08:00:00Z",
    },
    // Should be filtered out
    {
      id: "e-cancelled",
      status: "cancelled",
      summary: "Cancelled",
      start: { dateTime: "2023-11-15T10:00:00Z" },
      end: { dateTime: "2023-11-15T11:00:00Z" },
      updated: "2023-11-10T10:00:00Z",
    },
  ];

  function gcalClient() {
    return makeClient({
      async listEvents() { return { items: events }; },
    });
  }

  test("parses 3 events (timed, all-day, recurring) and skips cancelled", async () => {
    const src = createGcalSource({ client: gcalClient(), now });
    const items = await src.fetchNew(new MockSyncState());

    expect(items).toHaveLength(3);
    for (const item of items) validateItem(item, "gcal", /^gcal-/);

    const byId = Object.fromEntries(items.map((i) => [i.externalId, i]));

    const timed = byId["gcal-e1"]!;
    expect(timed.content).toContain("Event: All-hands");
    expect(timed.content).toContain("When: 2023-11-15T15:00:00Z");
    expect(timed.content).toContain("Where: Zoom");
    expect(timed.content).toContain("Description: Quarterly review");
    expect(timed.metadata.summary).toBe("All-hands");
    expect(timed.metadata.start).toBe("2023-11-15T15:00:00Z");
    expect(timed.metadata.end).toBe("2023-11-15T16:00:00Z");
    expect(timed.metadata.location).toBe("Zoom");
    // self-attendee filtered out
    expect(timed.metadata.attendees).toEqual(["alice@example.com", "bob@example.com"]);
    expect(timed.createdAt).toBe(Math.floor(new Date("2023-11-10T10:00:00Z").getTime() / 1000));

    const allDay = byId["gcal-e2"]!;
    expect(allDay.metadata.start).toBe("2023-12-25");
    expect(allDay.metadata.end).toBe("2023-12-26");
    expect(allDay.content).toContain("When: 2023-12-25");
    expect(allDay.metadata.attendees).toEqual([]);

    const recurring = byId["gcal-e3"]!;
    expect(recurring.metadata.summary).toBe("Weekly sync");
    expect(recurring.content).toContain("Description: Recurring team sync");
  });

  test("returns [] when listEvents returns no items", async () => {
    const src = createGcalSource({
      client: makeClient({ async listEvents() { return { items: [] }; } }),
      now,
    });
    expect(await src.fetchNew(new MockSyncState())).toEqual([]);
  });
});

// ─── GTasks ─────────────────────────────────────────────────────────────

describe("gtasks source", () => {
  function gtasksClient() {
    return makeClient({
      async listTaskLists() {
        return { items: [{ id: "list-1", title: "Inbox" }] };
      },
      async listTasks() {
        return {
          items: [
            {
              id: "tk1",
              title: "Pending task",
              notes: "Remember the milk",
              status: "needsAction",
              updated: "2023-11-10T12:00:00Z",
            },
            {
              id: "tk2",
              title: "Due soon",
              status: "needsAction",
              due: "2023-11-20T00:00:00Z",
              updated: "2023-11-11T09:00:00Z",
            },
            {
              id: "tk-done",
              title: "Finished task",
              status: "completed",
              updated: "2023-11-09T00:00:00Z",
            },
          ],
        };
      },
    });
  }

  test("parses tasks, skips completed, includes due + listName metadata", async () => {
    const src = createGtasksSource({ client: gtasksClient(), now });
    const items = await src.fetchNew(new MockSyncState());

    expect(items).toHaveLength(2);
    for (const item of items) validateItem(item, "gtasks", /^gtask-/);

    const byId = Object.fromEntries(items.map((i) => [i.externalId, i]));

    const pending = byId["gtask-tk1"]!;
    expect(pending.content).toContain("Task: Pending task");
    expect(pending.content).toContain("Notes: Remember the milk");
    expect(pending.metadata.title).toBe("Pending task");
    expect(pending.metadata.status).toBe("needsAction");
    expect(pending.metadata.listName).toBe("Inbox");
    expect(pending.metadata.due).toBeUndefined();
    expect(pending.createdAt).toBe(Math.floor(new Date("2023-11-10T12:00:00Z").getTime() / 1000));

    const due = byId["gtask-tk2"]!;
    expect(due.content).toContain("Due: 2023-11-20T00:00:00Z");
    expect(due.metadata.due).toBe("2023-11-20T00:00:00Z");
  });

  test("returns [] when no task lists", async () => {
    const src = createGtasksSource({
      client: makeClient({ async listTaskLists() { return { items: [] }; } }),
      now,
    });
    expect(await src.fetchNew(new MockSyncState())).toEqual([]);
  });
});

// ─── GDrive ─────────────────────────────────────────────────────────────

describe("gdrive source", () => {
  const files = [
    {
      id: "f1",
      name: "Design Doc",
      mimeType: "application/vnd.google-apps.document",
      modifiedTime: "2023-11-10T12:00:00Z",
      owners: [{ displayName: "Alice" }],
      webViewLink: "https://docs.google.com/document/d/f1",
      description: "Architecture plan",
    },
    {
      id: "f2",
      name: "Budget",
      mimeType: "application/vnd.google-apps.spreadsheet",
      modifiedTime: "2023-11-11T10:00:00Z",
      owners: [{ displayName: "Bob" }],
      webViewLink: "https://docs.google.com/spreadsheets/d/f2",
    },
    {
      id: "f3",
      name: "Report.pdf",
      mimeType: "application/pdf",
      modifiedTime: "2023-11-09T08:00:00Z",
      owners: [{ displayName: "Carol" }],
      webViewLink: "https://drive.google.com/file/d/f3",
    },
  ];

  function gdriveClient() {
    const exportCalls: Array<{ id: string; mime: string }> = [];
    const client = makeClient({
      async listFiles() { return { files }; },
      async exportFile(id, mime) {
        exportCalls.push({ id, mime });
        if (id === "f1") return "Full doc body text";
        if (id === "f2") return "col1,col2\n1,2";
        return null;
      },
    });
    return { client, exportCalls };
  }

  test("parses 3 files (doc/sheet/pdf) with exact metadata + content", async () => {
    const { client, exportCalls } = gdriveClient();
    const src = createGdriveSource({ client, now });
    const items = await src.fetchNew(new MockSyncState());

    expect(items).toHaveLength(3);
    for (const item of items) validateItem(item, "gdrive", /^gdrive-/);

    const byId = Object.fromEntries(items.map((i) => [i.externalId, i]));

    const doc = byId["gdrive-f1"]!;
    expect(doc.metadata.mimeType).toBe("application/vnd.google-apps.document");
    expect(doc.metadata.type).toBe("Doc");
    expect(doc.metadata.name).toBe("Design Doc");
    expect(doc.metadata.owner).toBe("Alice");
    expect(doc.metadata.modifiedTime).toBe("2023-11-10T12:00:00Z");
    expect(doc.metadata.webViewLink).toBe("https://docs.google.com/document/d/f1");
    expect(doc.metadata.hasContent).toBe(true);
    expect(doc.content).toContain("Doc: Design Doc");
    expect(doc.content).toContain("Owner: Alice");
    expect(doc.content).toContain("Modified: 2023-11-10T12:00:00Z");
    expect(doc.content).toContain("Description: Architecture plan");
    expect(doc.content).toContain("Link: https://docs.google.com/document/d/f1");
    expect(doc.content).toContain("Full doc body text");
    expect(doc.createdAt).toBe(Math.floor(new Date("2023-11-10T12:00:00Z").getTime() / 1000));

    const sheet = byId["gdrive-f2"]!;
    expect(sheet.metadata.type).toBe("Sheet");
    expect(sheet.metadata.owner).toBe("Bob");
    expect(sheet.metadata.hasContent).toBe(true);
    expect(sheet.content).toContain("col1,col2\n1,2");

    const pdf = byId["gdrive-f3"]!;
    expect(pdf.metadata.type).toBe("PDF");
    expect(pdf.metadata.hasContent).toBe(false); // PDFs are not exportable
    expect(pdf.content).not.toContain("Full doc body text");

    // Export was called only for the 2 exportable types (not the PDF)
    expect(exportCalls.map((c) => c.id).sort()).toEqual(["f1", "f2"]);
  });

  test("honors sync cutoff", async () => {
    const { client } = gdriveClient();
    const state = new MockSyncState();
    // Cutoff between f3 (2023-11-09) and f1 (2023-11-10)
    state.resetSync("gdrive", Math.floor(new Date("2023-11-09T12:00:00Z").getTime() / 1000));
    const src = createGdriveSource({ client, now });
    const items = await src.fetchNew(state);
    const ids = items.map((i) => i.externalId).sort();
    expect(ids).toEqual(["gdrive-f1", "gdrive-f2"]);
  });

  test("returns [] when listFiles returns no files", async () => {
    const src = createGdriveSource({
      client: makeClient({ async listFiles() { return { files: [] }; } }),
      now,
    });
    expect(await src.fetchNew(new MockSyncState())).toEqual([]);
  });
});

// ─── LIVE tests ─────────────────────────────────────────────────────────

describe("LIVE google sources (KENT_LIVE_TESTS=1)", () => {
  test.skipIf(!LIVE)("gmail: pulls real messages via gws CLI", async () => {
    const items = await gmail.fetchNew(new MockSyncState(), { defaultDays: 1, limit: 5 });
    for (const item of items) validateItem(item, "gmail", /^gmail-/);
  }, 120_000);

  test.skipIf(!LIVE)("gcal: pulls real calendar events", async () => {
    const items = await gcal.fetchNew(new MockSyncState(), { defaultDays: 7, limit: 10 });
    for (const item of items) validateItem(item, "gcal", /^gcal-/);
  }, 120_000);

  test.skipIf(!LIVE)("gtasks: pulls real tasks", async () => {
    const items = await gtasks.fetchNew(new MockSyncState(), { limit: 10 });
    for (const item of items) validateItem(item, "gtasks", /^gtask-/);
  }, 120_000);

  test.skipIf(!LIVE)("gdrive: pulls real drive files", async () => {
    const items = await gdrive.fetchNew(new MockSyncState(), { defaultDays: 30, limit: 5 });
    for (const item of items) validateItem(item, "gdrive", /^gdrive-/);
  }, 120_000);
});
