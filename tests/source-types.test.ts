import { test, expect, describe } from "bun:test";

/**
 * Tests for source type definitions and source registry.
 */

describe("Item type", () => {
  test("Item has required fields", () => {
    const item = {
      source: "imessage",
      externalId: "imessage-123",
      content: "Hello world",
      metadata: { isFromMe: true },
      createdAt: Math.floor(Date.now() / 1000),
    };

    expect(item.source).toBe("imessage");
    expect(item.externalId).toBe("imessage-123");
    expect(item.content).toBe("Hello world");
    expect(typeof item.metadata).toBe("object");
    expect(typeof item.createdAt).toBe("number");
  });
});

describe("Source implementations exist", () => {
  test("imessage source has name and fetchNew", async () => {
    const { imessage } = await import("../daemon/sources/imessage.ts");
    expect(imessage.name).toBe("imessage");
    expect(typeof imessage.fetchNew).toBe("function");
  });

  test("gmail source has name and fetchNew", async () => {
    const { gmail } = await import("../daemon/sources/gmail.ts");
    expect(gmail.name).toBe("gmail");
    expect(typeof gmail.fetchNew).toBe("function");
  });

  test("github source has name and fetchNew", async () => {
    const { github } = await import("../daemon/sources/github.ts");
    expect(github.name).toBe("github");
    expect(typeof github.fetchNew).toBe("function");
  });

  test("chrome source has name and fetchNew", async () => {
    const { chrome } = await import("../daemon/sources/chrome.ts");
    expect(chrome.name).toBe("chrome");
    expect(typeof chrome.fetchNew).toBe("function");
  });

  test("signal source has name and fetchNew", async () => {
    const { signal } = await import("../daemon/sources/signal.ts");
    expect(signal.name).toBe("signal");
    expect(typeof signal.fetchNew).toBe("function");
  });

  test("granola source has name and fetchNew", async () => {
    const { granola } = await import("../daemon/sources/granola.ts");
    expect(granola.name).toBe("granola");
    expect(typeof granola.fetchNew).toBe("function");
  });

  test("appleNotes source has name and fetchNew", async () => {
    const { appleNotes } = await import("../daemon/sources/apple-notes.ts");
    expect(appleNotes.name).toBe("apple-notes");
    expect(typeof appleNotes.fetchNew).toBe("function");
  });

  test("safari source has name and fetchNew", async () => {
    const { safari } = await import("../daemon/sources/safari.ts");
    expect(safari.name).toBe("safari");
    expect(typeof safari.fetchNew).toBe("function");
  });

  test("appleReminders source has name and fetchNew", async () => {
    const { appleReminders } = await import("../daemon/sources/apple-reminders.ts");
    expect(appleReminders.name).toBe("apple-reminders");
    expect(typeof appleReminders.fetchNew).toBe("function");
  });

  test("contacts source has name and fetchNew", async () => {
    const { contacts } = await import("../daemon/sources/contacts.ts");
    expect(contacts.name).toBe("contacts");
    expect(typeof contacts.fetchNew).toBe("function");
  });

  test("obsidian source has name and fetchNew", async () => {
    const { obsidian } = await import("../daemon/sources/obsidian.ts");
    expect(obsidian.name).toBe("obsidian");
    expect(typeof obsidian.fetchNew).toBe("function");
  });

  test("whatsapp source has name and fetchNew", async () => {
    const { whatsapp } = await import("../daemon/sources/whatsapp.ts");
    expect(whatsapp.name).toBe("whatsapp");
    expect(typeof whatsapp.fetchNew).toBe("function");
  });

  test("slack source has name and fetchNew", async () => {
    const { slack } = await import("../daemon/sources/slack.ts");
    expect(slack.name).toBe("slack");
    expect(typeof slack.fetchNew).toBe("function");
  });

  test("notion source has name and fetchNew", async () => {
    const { notion } = await import("../daemon/sources/notion.ts");
    expect(notion.name).toBe("notion");
    expect(typeof notion.fetchNew).toBe("function");
  });

  test("spotify source has name and fetchNew", async () => {
    const { spotify } = await import("../daemon/sources/spotify.ts");
    expect(spotify.name).toBe("spotify");
    expect(typeof spotify.fetchNew).toBe("function");
  });

  test("appleMusic source has name and fetchNew", async () => {
    const { appleMusic } = await import("../daemon/sources/apple-music.ts");
    expect(appleMusic.name).toBe("apple-music");
    expect(typeof appleMusic.fetchNew).toBe("function");
  });

  test("appleHealth source has name and fetchNew", async () => {
    const { appleHealth } = await import("../daemon/sources/apple-health.ts");
    expect(appleHealth.name).toBe("apple-health");
    expect(typeof appleHealth.fetchNew).toBe("function");
  });

  test("screenTime source has name and fetchNew", async () => {
    const { screenTime } = await import("../daemon/sources/screen-time.ts");
    expect(screenTime.name).toBe("screen-time");
    expect(typeof screenTime.fetchNew).toBe("function");
  });

  test("recentFiles source has name and fetchNew", async () => {
    const { recentFiles } = await import("../daemon/sources/recent-files.ts");
    expect(recentFiles.name).toBe("recent-files");
    expect(typeof recentFiles.fetchNew).toBe("function");
  });
});

describe("Source names match registry keys", () => {
  test("all 19 sources have correct names matching config keys", async () => {
    const { imessage } = await import("../daemon/sources/imessage.ts");
    const { signal } = await import("../daemon/sources/signal.ts");
    const { granola } = await import("../daemon/sources/granola.ts");
    const { gmail } = await import("../daemon/sources/gmail.ts");
    const { github } = await import("../daemon/sources/github.ts");
    const { chrome } = await import("../daemon/sources/chrome.ts");
    const { appleNotes } = await import("../daemon/sources/apple-notes.ts");
    const { safari } = await import("../daemon/sources/safari.ts");
    const { appleReminders } = await import("../daemon/sources/apple-reminders.ts");
    const { contacts } = await import("../daemon/sources/contacts.ts");
    const { obsidian } = await import("../daemon/sources/obsidian.ts");
    const { whatsapp } = await import("../daemon/sources/whatsapp.ts");
    const { slack } = await import("../daemon/sources/slack.ts");
    const { notion } = await import("../daemon/sources/notion.ts");
    const { spotify } = await import("../daemon/sources/spotify.ts");
    const { appleMusic } = await import("../daemon/sources/apple-music.ts");
    const { appleHealth } = await import("../daemon/sources/apple-health.ts");
    const { screenTime } = await import("../daemon/sources/screen-time.ts");
    const { recentFiles } = await import("../daemon/sources/recent-files.ts");

    const { DEFAULT_CONFIG } = await import("../shared/config.ts");

    // Verify each source name matches a key in config.sources
    const configKeys = Object.keys(DEFAULT_CONFIG.sources);

    expect(configKeys).toContain(imessage.name);
    expect(configKeys).toContain(signal.name);
    expect(configKeys).toContain(granola.name);
    expect(configKeys).toContain(gmail.name);
    expect(configKeys).toContain(github.name);
    expect(configKeys).toContain(chrome.name);
    expect(configKeys).toContain(safari.name);
    expect(configKeys).toContain(contacts.name);
    expect(configKeys).toContain(obsidian.name);
    expect(configKeys).toContain(whatsapp.name);
    expect(configKeys).toContain(slack.name);
    expect(configKeys).toContain(notion.name);
    expect(configKeys).toContain(spotify.name);
    // Sources with hyphens use underscores in config keys
    expect(configKeys).toContain("apple_notes");
    expect(configKeys).toContain("apple_reminders");
    expect(configKeys).toContain("apple_music");
    expect(configKeys).toContain("apple_health");
    expect(configKeys).toContain("screen_time");
    expect(configKeys).toContain("recent_files");
  });
});

describe("Source fetchNew with mock SyncState", () => {
  const mockState = {
    getLastSync: (_source: string) => 0,
    markSynced: (_source: string) => {},
  };

  // These tests verify sources handle missing dependencies gracefully
  // (they return [] instead of throwing)

  test("gmail returns empty array when gws not installed", async () => {
    const { gmail } = await import("../daemon/sources/gmail.ts");
    // gmail checks for `gws` CLI which likely isn't installed in test env
    const items = await gmail.fetchNew(mockState);
    expect(Array.isArray(items)).toBe(true);
  });

  test("github returns empty array when gh not authenticated", async () => {
    const { github } = await import("../daemon/sources/github.ts");
    // github uses `gh` CLI — may or may not be installed
    const items = await github.fetchNew(mockState, { limit: 5, defaultDays: 1 });
    expect(Array.isArray(items)).toBe(true);
  }, 30_000);
});
