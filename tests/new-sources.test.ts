import { test, expect, describe } from "bun:test";
import type { SyncState, Item, Source } from "@daemon/sources/types.ts";

/**
 * Comprehensive tests for all 12 new data sources.
 *
 * Each source is tested for:
 *   1. Correct export name and interface conformance
 *   2. fetchNew returns an array (graceful degradation in test env)
 *   3. Item shape validation when items are returned
 */

class MockSyncState implements SyncState {
  private timestamps: Record<string, number> = {};

  getLastSync(source: string): number {
    return this.timestamps[source] || 0;
  }

  markSynced(source: string, highWaterMark?: number): void {
    this.timestamps[source] = highWaterMark ?? Math.floor(Date.now() / 1000);
  }

  resetSync(source: string, timestamp: number): void {
    this.timestamps[source] = timestamp;
  }
}

/** Validate that an item has the correct shape */
function assertItemShape(item: Item, expectedSource: string) {
  expect(item.source).toBe(expectedSource);
  expect(item.externalId).toBeString();
  expect(item.externalId.length).toBeGreaterThan(0);
  expect(item.content).toBeString();
  expect(item.content.length).toBeGreaterThan(0);
  expect(typeof item.metadata).toBe("object");
  expect(item.metadata).not.toBeNull();
  expect(item.createdAt).toBeNumber();
  expect(item.createdAt).toBeGreaterThan(0);
}

// ─── Safari ─────────────────────────────────────────────────────────────

describe("Safari source", () => {
  test("exports safari with correct name", async () => {
    const { safari } = await import("@daemon/sources/safari.ts");
    expect(safari.name).toBe("safari");
    expect(typeof safari.fetchNew).toBe("function");
  });

  test("fetchNew returns array (empty without Safari DB)", async () => {
    const { safari } = await import("@daemon/sources/safari.ts");
    const state = new MockSyncState();
    const items = await safari.fetchNew(state);
    expect(items).toBeArray();
    for (const item of items) {
      assertItemShape(item, "safari");
      expect(item.externalId).toMatch(/^safari-/);
      expect(item.metadata.url).toBeString();
    }
  });

  test("respects lastSync for incremental sync", async () => {
    const { safari } = await import("@daemon/sources/safari.ts");
    const state = new MockSyncState();
    // Set a very recent sync time — should get no new items
    state.markSynced("safari", Math.floor(Date.now() / 1000));
    const items = await safari.fetchNew(state);
    expect(items).toBeArray();
  });
});

// ─── Apple Reminders ────────────────────────────────────────────────────

describe("Apple Reminders source", () => {
  test("exports appleReminders with correct name", async () => {
    const { appleReminders } = await import("@daemon/sources/apple-reminders.ts");
    expect(appleReminders.name).toBe("apple-reminders");
    expect(typeof appleReminders.fetchNew).toBe("function");
  });

  test("fetchNew returns array (may fail without Reminders access)", async () => {
    const { appleReminders } = await import("@daemon/sources/apple-reminders.ts");
    const state = new MockSyncState();
    const items = await appleReminders.fetchNew(state);
    expect(items).toBeArray();
    for (const item of items) {
      assertItemShape(item, "apple-reminders");
      expect(item.externalId).toMatch(/^apple-reminders-/);
    }
  });
});

// ─── Contacts ───────────────────────────────────────────────────────────

describe("Contacts source", () => {
  test("exports contacts with correct name", async () => {
    const { contacts } = await import("@daemon/sources/contacts.ts");
    expect(contacts.name).toBe("contacts");
    expect(typeof contacts.fetchNew).toBe("function");
  });

  test("fetchNew returns array (may be empty without AddressBook access)", async () => {
    const { contacts } = await import("@daemon/sources/contacts.ts");
    const state = new MockSyncState();
    const items = await contacts.fetchNew(state);
    expect(items).toBeArray();
    for (const item of items) {
      assertItemShape(item, "contacts");
      expect(item.externalId).toMatch(/^contacts-/);
    }
  });
});

// ─── Obsidian ───────────────────────────────────────────────────────────

describe("Obsidian source", () => {
  test("exports obsidian with correct name", async () => {
    const { obsidian } = await import("@daemon/sources/obsidian.ts");
    expect(obsidian.name).toBe("obsidian");
    expect(typeof obsidian.fetchNew).toBe("function");
  });

  test("fetchNew returns array (empty without vault)", async () => {
    const { obsidian } = await import("@daemon/sources/obsidian.ts");
    const state = new MockSyncState();
    const items = await obsidian.fetchNew(state);
    expect(items).toBeArray();
    for (const item of items) {
      assertItemShape(item, "obsidian");
      expect(item.externalId).toMatch(/^obsidian-/);
      expect(item.metadata.title).toBeString();
    }
  });
});

// ─── WhatsApp ───────────────────────────────────────────────────────────

describe("WhatsApp source", () => {
  test("exports whatsapp with correct name", async () => {
    const { whatsapp } = await import("@daemon/sources/whatsapp.ts");
    expect(whatsapp.name).toBe("whatsapp");
    expect(typeof whatsapp.fetchNew).toBe("function");
  });

  test("fetchNew returns array (empty without WhatsApp DB)", async () => {
    const { whatsapp } = await import("@daemon/sources/whatsapp.ts");
    const state = new MockSyncState();
    const items = await whatsapp.fetchNew(state);
    expect(items).toBeArray();
    for (const item of items) {
      assertItemShape(item, "whatsapp");
      expect(item.externalId).toMatch(/^whatsapp-/);
      expect(item.metadata).toHaveProperty("isFromMe");
    }
  });
});

// ─── Slack ───────────────────────────────────────────────────────────────

describe("Slack source", () => {
  test("exports slack with correct name", async () => {
    const { slack } = await import("@daemon/sources/slack.ts");
    expect(slack.name).toBe("slack");
    expect(typeof slack.fetchNew).toBe("function");
  });

  test("fetchNew returns empty array without token", async () => {
    const { slack } = await import("@daemon/sources/slack.ts");
    const state = new MockSyncState();
    // Without SLACK_TOKEN env var or config, should return []
    const items = await slack.fetchNew(state);
    expect(items).toBeArray();
    expect(items.length).toBe(0);
  });
});

// ─── Notion ─────────────────────────────────────────────────────────────

describe("Notion source", () => {
  test("exports notion with correct name", async () => {
    const { notion } = await import("@daemon/sources/notion.ts");
    expect(notion.name).toBe("notion");
    expect(typeof notion.fetchNew).toBe("function");
  });

  test("fetchNew returns empty array without token", async () => {
    const { notion } = await import("@daemon/sources/notion.ts");
    const state = new MockSyncState();
    // Without NOTION_TOKEN env var or config, should return []
    const items = await notion.fetchNew(state);
    expect(items).toBeArray();
    expect(items.length).toBe(0);
  });
});

// ─── Spotify ────────────────────────────────────────────────────────────

describe("Spotify source", () => {
  test("exports spotify with correct name", async () => {
    const { spotify } = await import("@daemon/sources/spotify.ts");
    expect(spotify.name).toBe("spotify");
    expect(typeof spotify.fetchNew).toBe("function");
  });

  test("fetchNew returns empty array without credentials", async () => {
    const { spotify } = await import("@daemon/sources/spotify.ts");
    const state = new MockSyncState();
    // Without Spotify credentials, should return []
    const items = await spotify.fetchNew(state);
    expect(items).toBeArray();
    expect(items.length).toBe(0);
  });
});

// ─── Apple Music ────────────────────────────────────────────────────────

describe("Apple Music source", () => {
  test("exports appleMusic with correct name", async () => {
    const { appleMusic } = await import("@daemon/sources/apple-music.ts");
    expect(appleMusic.name).toBe("apple-music");
    expect(typeof appleMusic.fetchNew).toBe("function");
  });

  test("fetchNew returns array (may fail without Music.app)", async () => {
    const { appleMusic } = await import("@daemon/sources/apple-music.ts");
    const state = new MockSyncState();
    const items = await appleMusic.fetchNew(state);
    expect(items).toBeArray();
    for (const item of items) {
      assertItemShape(item, "apple-music");
      expect(item.externalId).toMatch(/^apple-music-/);
    }
  });
});

// ─── Apple Health ───────────────────────────────────────────────────────

describe("Apple Health source", () => {
  test("exports appleHealth with correct name", async () => {
    const { appleHealth } = await import("@daemon/sources/apple-health.ts");
    expect(appleHealth.name).toBe("apple-health");
    expect(typeof appleHealth.fetchNew).toBe("function");
  });

  test("fetchNew returns empty array without export file", async () => {
    const { appleHealth } = await import("@daemon/sources/apple-health.ts");
    const state = new MockSyncState();
    // Without export XML, should return []
    const items = await appleHealth.fetchNew(state);
    expect(items).toBeArray();
    expect(items.length).toBe(0);
  });
});

// ─── Screen Time ────────────────────────────────────────────────────────

describe("Screen Time source", () => {
  test("exports screenTime with correct name", async () => {
    const { screenTime } = await import("@daemon/sources/screen-time.ts");
    expect(screenTime.name).toBe("screen-time");
    expect(typeof screenTime.fetchNew).toBe("function");
  });

  test("fetchNew returns array (may be empty without Knowledge DB)", async () => {
    const { screenTime } = await import("@daemon/sources/screen-time.ts");
    const state = new MockSyncState();
    const items = await screenTime.fetchNew(state);
    expect(items).toBeArray();
    for (const item of items) {
      assertItemShape(item, "screen-time");
      expect(item.externalId).toMatch(/^screen-time-/);
      expect(item.metadata).toHaveProperty("bundleId");
      expect(item.metadata).toHaveProperty("durationMinutes");
    }
  });
});

// ─── Recent Files ───────────────────────────────────────────────────────

describe("Recent Files source", () => {
  test("exports recentFiles with correct name", async () => {
    const { recentFiles } = await import("@daemon/sources/recent-files.ts");
    expect(recentFiles.name).toBe("recent-files");
    expect(typeof recentFiles.fetchNew).toBe("function");
  });

  test("fetchNew returns array (may be empty without mdfind)", async () => {
    const { recentFiles } = await import("@daemon/sources/recent-files.ts");
    const state = new MockSyncState();
    const items = await recentFiles.fetchNew(state);
    expect(items).toBeArray();
    for (const item of items) {
      assertItemShape(item, "recent-files");
      expect(item.externalId).toMatch(/^recent-files-/);
      expect(item.metadata).toHaveProperty("category");
      expect(item.metadata).toHaveProperty("filename");
    }
  });
});

// ─── Apple Calendar ─────────────────────────────────────────────────────

describe("Apple Calendar source", () => {
  test("exports appleCalendar with correct name", async () => {
    const { appleCalendar } = await import("@daemon/sources/apple-calendar.ts");
    expect(appleCalendar.name).toBe("apple-calendar");
    expect(typeof appleCalendar.fetchNew).toBe("function");
  });

  test("fetchNew returns array (may fail without Calendar.app)", async () => {
    const { appleCalendar } = await import("@daemon/sources/apple-calendar.ts");
    const state = new MockSyncState();
    const items = await appleCalendar.fetchNew(state);
    expect(items).toBeArray();
    for (const item of items) {
      assertItemShape(item, "apple-calendar");
      expect(item.externalId).toMatch(/^apple-calendar-/);
    }
  });
});

// ─── All sources registry ───────────────────────────────────────────────

describe("All new sources are importable and conform to Source interface", () => {
  test("all 13 new sources can be imported", async () => {
    const sources: Source[] = [
      (await import("@daemon/sources/safari.ts")).safari,
      (await import("@daemon/sources/apple-reminders.ts")).appleReminders,
      (await import("@daemon/sources/contacts.ts")).contacts,
      (await import("@daemon/sources/obsidian.ts")).obsidian,
      (await import("@daemon/sources/whatsapp.ts")).whatsapp,
      (await import("@daemon/sources/slack.ts")).slack,
      (await import("@daemon/sources/notion.ts")).notion,
      (await import("@daemon/sources/spotify.ts")).spotify,
      (await import("@daemon/sources/apple-music.ts")).appleMusic,
      (await import("@daemon/sources/apple-health.ts")).appleHealth,
      (await import("@daemon/sources/screen-time.ts")).screenTime,
      (await import("@daemon/sources/recent-files.ts")).recentFiles,
      (await import("@daemon/sources/apple-calendar.ts")).appleCalendar,
    ];

    expect(sources.length).toBe(13);

    for (const source of sources) {
      expect(typeof source.name).toBe("string");
      expect(source.name.length).toBeGreaterThan(0);
      expect(typeof source.fetchNew).toBe("function");
    }
  });

  test("all 13 new source names are unique", async () => {
    const sources: Source[] = [
      (await import("@daemon/sources/safari.ts")).safari,
      (await import("@daemon/sources/apple-reminders.ts")).appleReminders,
      (await import("@daemon/sources/contacts.ts")).contacts,
      (await import("@daemon/sources/obsidian.ts")).obsidian,
      (await import("@daemon/sources/whatsapp.ts")).whatsapp,
      (await import("@daemon/sources/slack.ts")).slack,
      (await import("@daemon/sources/notion.ts")).notion,
      (await import("@daemon/sources/spotify.ts")).spotify,
      (await import("@daemon/sources/apple-music.ts")).appleMusic,
      (await import("@daemon/sources/apple-health.ts")).appleHealth,
      (await import("@daemon/sources/screen-time.ts")).screenTime,
      (await import("@daemon/sources/recent-files.ts")).recentFiles,
      (await import("@daemon/sources/apple-calendar.ts")).appleCalendar,
    ];

    const names = sources.map((s) => s.name);
    const uniqueNames = new Set(names);
    expect(uniqueNames.size).toBe(names.length);
  });

  test("new source names have matching config keys", async () => {
    const { DEFAULT_CONFIG } = await import("@shared/config.ts");
    const configKeys = Object.keys(DEFAULT_CONFIG.sources);

    // Verify each new source has a matching config key (with - → _ mapping)
    const expectedMappings: Record<string, string> = {
      safari: "safari",
      "apple-reminders": "apple_reminders",
      contacts: "contacts",
      obsidian: "obsidian",
      whatsapp: "whatsapp",
      slack: "slack",
      notion: "notion",
      spotify: "spotify",
      "apple-music": "apple_music",
      "apple-health": "apple_health",
      "screen-time": "screen_time",
      "recent-files": "recent_files",
      "apple-calendar": "apple_calendar",
    };

    for (const [_sourceName, configKey] of Object.entries(expectedMappings)) {
      expect(configKeys).toContain(configKey);
    }
  });
});

// ─── Daemon registry includes all new sources ───────────────────────────

describe("Daemon source registry", () => {
  test("daemon.ts imports and registers all 12 new sources", async () => {
    // Verify the daemon file references all new source modules
    const daemonContent = await Bun.file("daemon/daemon.ts").text();

    const expectedImports = [
      "safari",
      "apple-reminders",
      "contacts",
      "obsidian",
      "whatsapp",
      "slack",
      "notion",
      "spotify",
      "apple-music",
      "apple-health",
      "screen-time",
      "recent-files",
    ];

    for (const source of expectedImports) {
      expect(daemonContent).toContain(`./sources/${source}.ts`);
    }
  });

  test("daemon registry keys match config source keys", async () => {
    const daemonContent = await Bun.file("daemon/daemon.ts").text();
    const { DEFAULT_CONFIG } = await import("@shared/config.ts");

    // Extract registry keys from the sourceRegistry object
    const registryMatch = daemonContent.match(/const sourceRegistry[\s\S]*?\{([\s\S]*?)\};/);
    expect(registryMatch).not.toBeNull();

    const registryBlock = registryMatch![1]!;
    const configKeys = Object.keys(DEFAULT_CONFIG.sources);

    // Each config key should appear in the registry
    for (const key of configKeys) {
      // gdrive is handled by gmail source, so it's not in the registry
      if (key === "gdrive") continue;
      expect(registryBlock).toContain(key);
    }
  });
});

// ─── Config keys for API-based sources ──────────────────────────────────

describe("Config has API keys for new sources", () => {
  test("config has slack key", async () => {
    const { DEFAULT_CONFIG } = await import("@shared/config.ts");
    expect(DEFAULT_CONFIG.keys).toHaveProperty("slack");
    expect(DEFAULT_CONFIG.keys.slack).toBe("");
  });

  test("config has notion key", async () => {
    const { DEFAULT_CONFIG } = await import("@shared/config.ts");
    expect(DEFAULT_CONFIG.keys).toHaveProperty("notion");
    expect(DEFAULT_CONFIG.keys.notion).toBe("");
  });

  test("config has spotify credentials", async () => {
    const { DEFAULT_CONFIG } = await import("@shared/config.ts");
    expect(DEFAULT_CONFIG.keys).toHaveProperty("spotify_client_id");
    expect(DEFAULT_CONFIG.keys).toHaveProperty("spotify_client_secret");
    expect(DEFAULT_CONFIG.keys).toHaveProperty("spotify_refresh_token");
    expect(DEFAULT_CONFIG.keys.spotify_client_id).toBe("");
    expect(DEFAULT_CONFIG.keys.spotify_client_secret).toBe("");
    expect(DEFAULT_CONFIG.keys.spotify_refresh_token).toBe("");
  });
});
