import { test, expect, describe } from "bun:test";
import type { Source } from "@daemon/sources/types.ts";

// Per-source behavioral + LIVE tests live under tests/sources/<name>.test.ts.
// This file is the registry / interface conformance check across all 22 source
// files (25 source exports — gmail.ts contributes gmail/gcal/gtasks/gdrive).

describe("Source registry", () => {
  test("all 22 source files export Source-conformant objects (25 exports total)", async () => {
    const sources: Source[] = [
      (await import("@daemon/sources/imessage.ts")).imessage,
      (await import("@daemon/sources/signal.ts")).signal,
      (await import("@daemon/sources/whatsapp.ts")).whatsapp,
      (await import("@daemon/sources/granola.ts")).granola,
      (await import("@daemon/sources/gmail.ts")).gmail,
      (await import("@daemon/sources/gmail.ts")).gcal,
      (await import("@daemon/sources/gmail.ts")).gtasks,
      (await import("@daemon/sources/gmail.ts")).gdrive,
      (await import("@daemon/sources/outlook.ts")).outlook,
      (await import("@daemon/sources/github.ts")).github,
      (await import("@daemon/sources/chrome.ts")).chrome,
      (await import("@daemon/sources/safari.ts")).safari,
      (await import("@daemon/sources/apple-notes.ts")).appleNotes,
      (await import("@daemon/sources/apple-calendar.ts")).appleCalendar,
      (await import("@daemon/sources/apple-reminders.ts")).appleReminders,
      (await import("@daemon/sources/apple-health.ts")).appleHealth,
      (await import("@daemon/sources/apple-music.ts")).appleMusic,
      (await import("@daemon/sources/contacts.ts")).contacts,
      (await import("@daemon/sources/obsidian.ts")).obsidian,
      (await import("@daemon/sources/notion.ts")).notion,
      (await import("@daemon/sources/slack.ts")).slack,
      (await import("@daemon/sources/spotify.ts")).spotify,
      (await import("@daemon/sources/screen-time.ts")).screenTime,
      (await import("@daemon/sources/recent-files.ts")).recentFiles,
      (await import("@daemon/sources/ai-coding.ts")).aiCoding,
    ];

    expect(sources.length).toBe(25);

    const expectedNames = new Set([
      "imessage", "signal", "whatsapp", "granola",
      "gmail", "gcal", "gtasks", "gdrive",
      "outlook", "github",
      "chrome", "safari",
      "apple-notes", "apple-calendar", "apple-reminders", "apple-health", "apple-music",
      "contacts", "obsidian", "notion", "slack", "spotify",
      "screen-time", "recent-files", "ai_coding",
    ]);

    const names = new Set(sources.map((s) => s.name));
    expect(names).toEqual(expectedNames);

    for (const source of sources) {
      expect(typeof source.name).toBe("string");
      expect(source.name.length).toBeGreaterThan(0);
      expect(typeof source.fetchNew).toBe("function");
    }
  });

  test("source names are unique", async () => {
    const sources: Source[] = [
      (await import("@daemon/sources/imessage.ts")).imessage,
      (await import("@daemon/sources/signal.ts")).signal,
      (await import("@daemon/sources/whatsapp.ts")).whatsapp,
      (await import("@daemon/sources/granola.ts")).granola,
      (await import("@daemon/sources/gmail.ts")).gmail,
      (await import("@daemon/sources/gmail.ts")).gcal,
      (await import("@daemon/sources/gmail.ts")).gtasks,
      (await import("@daemon/sources/gmail.ts")).gdrive,
      (await import("@daemon/sources/outlook.ts")).outlook,
      (await import("@daemon/sources/github.ts")).github,
      (await import("@daemon/sources/chrome.ts")).chrome,
      (await import("@daemon/sources/safari.ts")).safari,
      (await import("@daemon/sources/apple-notes.ts")).appleNotes,
      (await import("@daemon/sources/apple-calendar.ts")).appleCalendar,
      (await import("@daemon/sources/apple-reminders.ts")).appleReminders,
      (await import("@daemon/sources/apple-health.ts")).appleHealth,
      (await import("@daemon/sources/apple-music.ts")).appleMusic,
      (await import("@daemon/sources/contacts.ts")).contacts,
      (await import("@daemon/sources/obsidian.ts")).obsidian,
      (await import("@daemon/sources/notion.ts")).notion,
      (await import("@daemon/sources/slack.ts")).slack,
      (await import("@daemon/sources/spotify.ts")).spotify,
      (await import("@daemon/sources/screen-time.ts")).screenTime,
      (await import("@daemon/sources/recent-files.ts")).recentFiles,
      (await import("@daemon/sources/ai-coding.ts")).aiCoding,
    ];

    const names = sources.map((s) => s.name);
    expect(new Set(names).size).toBe(names.length);
  });
});
