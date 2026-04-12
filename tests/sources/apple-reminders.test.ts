import { test, expect, describe } from "bun:test";
import { MockSyncState, validateItem, LIVE } from "./_helpers.ts";
import {
  appleReminders,
  createAppleRemindersSource,
  _parseAppleScriptOutput,
} from "@daemon/sources/apple-reminders.ts";

const SEP = "<<<SEP>>>";
const REC = "<<<REM>>>";

function row(fields: {
  id: string;
  name: string;
  body?: string;
  dueDate?: string;
  completionDate?: string;
  completed?: boolean;
  priority?: number;
  list?: string;
  createdAt?: string;
  modifiedAt?: string;
}): string {
  return [
    fields.id,
    fields.name,
    fields.body ?? "",
    fields.dueDate ?? "",
    fields.completionDate ?? "",
    fields.completed ? "true" : "false",
    String(fields.priority ?? 0),
    fields.list ?? "Reminders",
    fields.createdAt ?? "",
    fields.modifiedAt ?? "",
  ].join(SEP);
}

function stdout(...rows: string[]): string {
  return rows.map((r) => REC + r).join("") + "\n";
}

describe("apple-reminders source", () => {
  test("exports stable name and factory", () => {
    expect(appleReminders.name).toBe("apple-reminders");
    expect(typeof appleReminders.fetchNew).toBe("function");
    expect(typeof createAppleRemindersSource).toBe("function");
  });

  test("parses canned reminders stdout into exact items", async () => {
    const canned = stdout(
      row({
        id: "x-apple-reminder://A1",
        name: "Buy milk",
        body: "2% organic",
        dueDate: "2025-06-12T18:00:00",
        completed: false,
        priority: 1, // high
        list: "Groceries",
        createdAt: "2025-06-10T09:00:00",
        modifiedAt: "2025-06-10T09:30:00",
      }),
      row({
        id: "x-apple-reminder://A2",
        name: "Submit expenses",
        completed: true,
        completionDate: "2025-06-09T12:00:00",
        priority: 5, // medium
        list: "Work",
        createdAt: "2025-06-05T08:00:00",
      }),
      row({
        id: "x-apple-reminder://A3",
        name: "Water plants",
        completed: false,
        priority: 0, // none
        list: "Home",
      }),
    );

    const src = createAppleRemindersSource({
      exec: async () => canned,
      now: () => Date.parse("2025-06-10T10:00:00Z"),
    });
    const items = await src.fetchNew(new MockSyncState());

    expect(items).toHaveLength(3);
    for (const item of items) validateItem(item, "apple-reminders", /.+/);

    const [a, b, c] = items;

    expect(a!.externalId).toBe("x-apple-reminder://A1");
    expect(a!.content).toBe(
      [
        "# Buy milk",
        "List: Groceries",
        "Status: incomplete",
        "Priority: high",
        "Due: 2025-06-12T18:00:00",
        "",
        "2% organic",
      ].join("\n"),
    );
    expect(a!.metadata.name).toBe("Buy milk");
    expect(a!.metadata.list).toBe("Groceries");
    expect(a!.metadata.completed).toBe(false);
    expect(a!.metadata.priority).toBe(1);
    expect(a!.metadata.priorityLabel).toBe("high");
    expect(a!.metadata.dueDate).toBe(
      Math.floor(new Date("2025-06-12T18:00:00").getTime() / 1000),
    );
    expect(a!.metadata.completionDate).toBeNull();
    expect(a!.metadata.modifiedAt).toBe(
      Math.floor(new Date("2025-06-10T09:30:00").getTime() / 1000),
    );
    expect(a!.createdAt).toBe(
      Math.floor(new Date("2025-06-10T09:00:00").getTime() / 1000),
    );

    expect(b!.externalId).toBe("x-apple-reminder://A2");
    expect(b!.content).toContain("Status: completed");
    expect(b!.content).toContain("Priority: medium");
    expect(b!.content).toContain("Completed: 2025-06-09T12:00:00");
    expect(b!.metadata.completed).toBe(true);
    expect(b!.metadata.priorityLabel).toBe("medium");
    expect(b!.metadata.completionDate).toBe(
      Math.floor(new Date("2025-06-09T12:00:00").getTime() / 1000),
    );
    expect(b!.metadata.dueDate).toBeNull();

    expect(c!.metadata.list).toBe("Home");
    expect(c!.metadata.priorityLabel).toBeNull();
    expect(c!.content).not.toContain("Priority:");
    expect(c!.content).not.toContain("Due:");
    // Falls back to now() for createdAt when creation date blank
    expect(c!.createdAt).toBe(Math.floor(Date.parse("2025-06-10T10:00:00Z") / 1000));
  });

  test("reminder with no id falls back to apple-reminders-<name>", async () => {
    const canned =
      REC +
      row({
        id: "",
        name: "Nameless task",
        list: "Inbox",
      }) +
      "\n";
    const src = createAppleRemindersSource({
      exec: async () => canned,
      now: () => Date.parse("2025-06-10T00:00:00Z"),
    });
    const items = await src.fetchNew(new MockSyncState());
    expect(items).toHaveLength(1);
    expect(items[0]!.externalId).toBe("apple-reminders-Nameless task");
  });

  test("parseAppleScriptOutput handles empty / malformed input", () => {
    expect(_parseAppleScriptOutput("")).toEqual([]);
    // malformed: too few fields
    expect(_parseAppleScriptOutput(REC + "a" + SEP + "b")).toEqual([]);
  });

  test("fetchNew returns [] when exec throws", async () => {
    const src = createAppleRemindersSource({
      exec: async () => {
        throw new Error("AppleScript not permitted");
      },
    });
    expect(await src.fetchNew(new MockSyncState())).toEqual([]);
  });

  test.skipIf(!LIVE)("LIVE: exported appleReminders returns an array", async () => {
    const items = await appleReminders.fetchNew(new MockSyncState());
    expect(Array.isArray(items)).toBe(true);
  }, 60_000);
});
