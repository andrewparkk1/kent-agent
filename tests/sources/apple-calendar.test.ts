import { test, expect, describe } from "bun:test";
import { MockSyncState, validateItem, LIVE } from "./_helpers.ts";
import {
  appleCalendar,
  createAppleCalendarSource,
  _parseAppleScriptOutput,
  _eventsToItems,
} from "@daemon/sources/apple-calendar.ts";

const SEP = "<<<SEP>>>";
const DELIM = "<<<EVENT>>>";

/** Build one event row matching the AppleScript output format. */
function row(fields: {
  uid: string;
  summary: string;
  start: string;
  end: string;
  location?: string;
  description?: string;
  cal?: string;
  allDay?: boolean;
  recurrence?: string;
}): string {
  return [
    fields.uid,
    fields.summary,
    fields.start,
    fields.end,
    fields.location ?? "",
    fields.description ?? "",
    fields.cal ?? "Home",
    fields.allDay ? "true" : "false",
    fields.recurrence ?? "",
  ].join(SEP);
}

function stdout(...rows: string[]): string {
  return rows.map((r) => DELIM + r).join("") + "\n";
}

describe("apple-calendar source", () => {
  test("exports stable name and factory", () => {
    expect(appleCalendar.name).toBe("apple-calendar");
    expect(typeof appleCalendar.fetchNew).toBe("function");
    expect(typeof createAppleCalendarSource).toBe("function");
  });

  test("parses a canned AppleScript payload into exact items", async () => {
    const canned = stdout(
      row({
        uid: "EVT-1",
        summary: "Team standup",
        start: "2025-06-10T09:00:00",
        end: "2025-06-10T09:30:00",
        location: "Zoom Room A",
        description: "Daily sync",
        cal: "Work",
        allDay: false,
      }),
      row({
        uid: "EVT-2",
        summary: "Birthday",
        start: "2025-06-11T00:00:00",
        end: "2025-06-12T00:00:00",
        cal: "Personal",
        allDay: true,
        recurrence: "FREQ=YEARLY",
      }),
      row({
        uid: "EVT-3",
        summary: "Dentist",
        start: "2025-06-12T15:00:00",
        end: "2025-06-12T16:00:00",
        location: "123 Main St",
        cal: "Health",
        allDay: false,
      }),
    );

    const src = createAppleCalendarSource({
      exec: async () => canned,
      now: () => Date.parse("2025-06-10T08:00:00Z"),
    });
    const items = await src.fetchNew(new MockSyncState());

    expect(items).toHaveLength(3);
    for (const item of items) validateItem(item, "apple-calendar", /^apple-calendar-EVT-/);

    const [a, b, c] = items;
    expect(a!.externalId).toBe("apple-calendar-EVT-1");
    expect(a!.content).toBe(
      "Team standup\n2025-06-10T09:00:00 - 2025-06-10T09:30:00\nZoom Room A",
    );
    expect(a!.metadata.summary).toBe("Team standup");
    expect(a!.metadata.startDate).toBe("2025-06-10T09:00:00");
    expect(a!.metadata.endDate).toBe("2025-06-10T09:30:00");
    expect(a!.metadata.location).toBe("Zoom Room A");
    expect(a!.metadata.description).toBe("Daily sync");
    expect(a!.metadata.calendarName).toBe("Work");
    expect(a!.metadata.allDay).toBe(false);
    expect(a!.metadata.recurrence).toBeUndefined();
    expect(a!.createdAt).toBe(Math.floor(new Date("2025-06-10T09:00:00").getTime() / 1000));

    expect(b!.externalId).toBe("apple-calendar-EVT-2");
    expect(b!.metadata.allDay).toBe(true);
    expect(b!.metadata.recurrence).toBe("FREQ=YEARLY");
    expect(b!.metadata.location).toBe("");
    // No location line in content for event with blank location
    expect(b!.content).toBe("Birthday\n2025-06-11T00:00:00 - 2025-06-12T00:00:00");

    expect(c!.externalId).toBe("apple-calendar-EVT-3");
    expect(c!.metadata.calendarName).toBe("Health");
    expect(c!.content).toContain("123 Main St");
  });

  test("parseAppleScriptOutput returns [] on empty stdout", () => {
    expect(_parseAppleScriptOutput("")).toEqual([]);
    expect(_parseAppleScriptOutput("\n")).toEqual([]);
  });

  test("parser skips malformed rows with too few fields", () => {
    const bad = DELIM + "only-two" + SEP + "fields";
    const good =
      DELIM +
      row({
        uid: "OK-1",
        summary: "Ok",
        start: "2025-01-01T00:00:00",
        end: "2025-01-01T01:00:00",
      });
    const parsed = _parseAppleScriptOutput(bad + good);
    expect(parsed).toHaveLength(1);
    expect(parsed[0]!.uid).toBe("OK-1");
  });

  test("eventsToItems drops rows with blank summary", () => {
    const items = _eventsToItems([
      {
        uid: "X",
        summary: "",
        startDate: "2025-01-01T00:00:00",
        endDate: "2025-01-01T01:00:00",
        location: "",
        description: "",
        calendarName: "",
        allDay: false,
        recurrence: "",
      },
    ]);
    expect(items).toEqual([]);
  });

  test("fetchNew returns [] when exec throws (no permission)", async () => {
    const src = createAppleCalendarSource({
      exec: async () => {
        throw new Error("not authorized to send Apple events");
      },
    });
    const items = await src.fetchNew(new MockSyncState());
    expect(items).toEqual([]);
  });

  test("daysBefore shrinks based on last sync", async () => {
    let received = -1;
    const src = createAppleCalendarSource({
      exec: async (daysBefore: number) => {
        received = daysBefore;
        return "";
      },
      now: () => Date.parse("2025-06-10T00:00:00Z"),
    });
    const state = new MockSyncState();
    // Last sync ~2 days ago
    state.resetSync(
      "apple-calendar",
      Math.floor(Date.parse("2025-06-08T00:00:00Z") / 1000),
    );
    await src.fetchNew(state);
    expect(received).toBe(2);
  });

  test.skipIf(!LIVE)("LIVE: exported appleCalendar returns an array", async () => {
    const items = await appleCalendar.fetchNew(new MockSyncState());
    expect(Array.isArray(items)).toBe(true);
  }, 60_000);
});
