import { test, expect, describe, beforeEach } from "bun:test";
import { mkdtempSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { MockSyncState, validateItem, LIVE } from "./_helpers.ts";
import { createGranolaSource, granola } from "@daemon/sources/granola.ts";

const FIXED_NOW_SEC = 1_700_000_000; // 2023-11-14T22:13:20Z

function makeGranolaDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "granola-"));

  const docCreated = new Date((FIXED_NOW_SEC - 3600) * 1000).toISOString();
  const eventStart = new Date((FIXED_NOW_SEC + 2 * 86400) * 1000).toISOString();
  const contactCreated = new Date((FIXED_NOW_SEC - 1800) * 1000).toISOString();

  const state = {
    documents: {
      "doc-1": {
        id: "doc-1",
        title: "Q4 Planning",
        user_id: "user-me",
        created_at: docCreated,
        notes_markdown: "- Discussed roadmap\n- Assigned owners",
        summary: "Team aligned on Q4 priorities and blockers.",
        people: {
          attendees: [
            { name: "Alice", email: "alice@example.com" },
            { name: "Bob", email: "bob@example.com" },
          ],
        },
        chapters: [{ title: "Intros" }, { title: "Roadmap" }],
      },
      "doc-2": {
        id: "doc-2",
        title: "Old Deleted",
        user_id: "user-me",
        created_at: new Date((FIXED_NOW_SEC - 7 * 86400) * 1000).toISOString(),
        deleted_at: docCreated,
        notes_markdown: "nope",
      },
      "doc-3": {
        // Different user — should be filtered out
        id: "doc-3",
        title: "Someone else's note",
        user_id: "user-other",
        created_at: docCreated,
        notes_markdown: "other user",
      },
    },
    events: [
      {
        id: "evt-1",
        summary: "Team standup",
        start: { dateTime: eventStart },
        end: { dateTime: eventStart },
        location: "Zoom",
        status: "confirmed",
      },
      {
        id: "evt-past",
        summary: "Old event",
        start: { dateTime: new Date((FIXED_NOW_SEC - 86400) * 1000).toISOString() },
        end: { dateTime: new Date((FIXED_NOW_SEC - 86400) * 1000).toISOString() },
        status: "confirmed",
      },
    ],
    people: [
      {
        name: "Carol Jones",
        email: "carol@example.com",
        company_name: "Acme",
        job_title: "CEO",
        created_at: contactCreated,
      },
    ],
  };

  const outer = { cache: JSON.stringify({ state }) };
  writeFileSync(join(dir, "cache-v3.json"), JSON.stringify(outer));
  return dir;
}

describe("granola source (fixture)", () => {
  let dir: string;
  beforeEach(() => {
    dir = makeGranolaDir();
  });

  test("existing export still works", () => {
    expect(granola.name).toBe("granola");
    expect(typeof granola.fetchNew).toBe("function");
  });

  test("emits meeting, event, and contact items from local cache", async () => {
    const src = createGranolaSource({
      dataDir: dir,
      now: () => FIXED_NOW_SEC,
      enableApiFetch: false,
    });
    const items = await src.fetchNew(new MockSyncState());

    // doc-1 (meeting), evt-1 (future event), carol (contact) = 3
    // doc-2 (deleted), doc-3 (other user), evt-past (past) should be filtered
    expect(items.length).toBe(3);
    for (const item of items) {
      validateItem(item, "granola", /^granola-(meeting|event|contact)-/);
    }

    const meeting = items.find((i) => i.externalId === "granola-meeting-doc-1");
    expect(meeting).toBeDefined();
    expect(meeting!.content).toContain("# Q4 Planning");
    expect(meeting!.content).toContain("Attendees: Alice, Bob");
    expect(meeting!.content).toContain("Topics: Intros → Roadmap");
    expect(meeting!.content).toContain("Team aligned on Q4");
    expect(meeting!.content).toContain("Discussed roadmap");
    expect(meeting!.metadata.title).toBe("Q4 Planning");
    expect(meeting!.metadata.hasSummary).toBe(true);
    expect(meeting!.metadata.hasNotes).toBe(true);
    expect(Array.isArray(meeting!.metadata.attendees)).toBe(true);
    expect(meeting!.metadata.attendees.length).toBe(2);

    const event = items.find((i) => i.externalId === "granola-event-evt-1");
    expect(event).toBeDefined();
    expect(event!.content).toContain("Event: Team standup");
    expect(event!.content).toContain("Where: Zoom");
    expect(event!.metadata.type).toBe("calendar-event");

    const contact = items.find((i) => i.externalId === "granola-contact-carol@example.com");
    expect(contact).toBeDefined();
    expect(contact!.content).toContain("Carol Jones");
    expect(contact!.content).toContain("<carol@example.com>");
    expect(contact!.content).toContain("@ Acme");
    expect(contact!.content).toContain("(CEO)");
    expect(contact!.metadata.type).toBe("contact");
    expect(contact!.metadata.email).toBe("carol@example.com");
  });

  test("sync cutoff: re-sync with lastSync in the future returns empty", async () => {
    const src = createGranolaSource({
      dataDir: dir,
      now: () => FIXED_NOW_SEC,
      enableApiFetch: false,
    });
    const state = new MockSyncState();
    state.markSynced("granola", FIXED_NOW_SEC + 10000);
    const items = await src.fetchNew(state);
    // Meeting and contact are gated on created_at > lastSync; only the future event still passes
    const meetings = items.filter((i) => i.externalId.startsWith("granola-meeting"));
    const contacts = items.filter((i) => i.externalId.startsWith("granola-contact"));
    expect(meetings.length).toBe(0);
    expect(contacts.length).toBe(0);
  });

  test("missing data dir returns empty", async () => {
    const src = createGranolaSource({
      dataDir: join(tmpdir(), "nonexistent-granola-" + Math.random()),
      now: () => FIXED_NOW_SEC,
      enableApiFetch: false,
    });
    const items = await src.fetchNew(new MockSyncState());
    expect(items).toEqual([]);
  });

  test.skipIf(!LIVE)("LIVE: reads from real Granola data dir", async () => {
    const items = await granola.fetchNew(new MockSyncState(), { defaultDays: 30, limit: 10 });
    for (const item of items) validateItem(item, "granola", /^granola-/);
  }, 120_000);
});
