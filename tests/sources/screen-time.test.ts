import { test, expect, describe, beforeAll, afterAll } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { MockSyncState, validateItem, LIVE } from "./_helpers.ts";
import { createScreenTimeSource, screenTime } from "@daemon/sources/screen-time.ts";

const CORE_DATA_EPOCH_OFFSET = 978307200;
const unixToCore = (unix: number) => unix - CORE_DATA_EPOCH_OFFSET;

let tmpDir: string;
let dbPath: string;

// Fixed "day" — 2024-06-15 UTC — so aggregated date bucket is stable.
const DAY_START_UNIX = Math.floor(new Date("2024-06-15T00:00:00Z").getTime() / 1000);
const DAY2_START_UNIX = Math.floor(new Date("2024-06-16T00:00:00Z").getTime() / 1000);

beforeAll(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "kent-st-test-"));
  dbPath = join(tmpDir, "knowledgeC.db");

  const db = new Database(dbPath);
  db.exec(`
    CREATE TABLE ZOBJECT (
      Z_PK INTEGER PRIMARY KEY AUTOINCREMENT,
      ZSTREAMNAME TEXT,
      ZVALUESTRING TEXT,
      ZSTARTDATE REAL,
      ZENDDATE REAL,
      ZSECONDSFROMGMT INTEGER
    );
  `);

  const insert = db.prepare(
    `INSERT INTO ZOBJECT (ZSTREAMNAME, ZVALUESTRING, ZSTARTDATE, ZENDDATE, ZSECONDSFROMGMT) VALUES (?, ?, ?, ?, ?)`
  );

  // Safari: two sessions on day 1 totaling 30 minutes (10 + 20)
  insert.run("/app/usage", "com.apple.Safari", unixToCore(DAY_START_UNIX + 3600), unixToCore(DAY_START_UNIX + 3600 + 600), 0);
  insert.run("/app/usage", "com.apple.Safari", unixToCore(DAY_START_UNIX + 7200), unixToCore(DAY_START_UNIX + 7200 + 1200), 0);

  // Slack: one session on day 1, 5 minutes, different stream name ('/app/inFocus')
  insert.run("/app/inFocus", "com.tinyspeck.slackmacgap", unixToCore(DAY_START_UNIX + 10000), unixToCore(DAY_START_UNIX + 10000 + 300), 0);

  // Safari: one session on day 2, 15 minutes
  insert.run("/app/usage", "com.apple.Safari", unixToCore(DAY2_START_UNIX + 3600), unixToCore(DAY2_START_UNIX + 3600 + 900), 0);

  // Unknown bundle — humanize fallback (MyCoolApp -> "My Cool App")
  insert.run("/app/usage", "com.example.MyCoolApp", unixToCore(DAY_START_UNIX + 20000), unixToCore(DAY_START_UNIX + 20000 + 120), 0);

  // Sub-minute entry — filtered out (20 sec → rounds to 0 minutes)
  insert.run("/app/usage", "com.apple.Terminal", unixToCore(DAY_START_UNIX + 30000), unixToCore(DAY_START_UNIX + 30000 + 20), 0);

  // Wrong stream — ignored entirely
  insert.run("/other/stream", "com.apple.Safari", unixToCore(DAY_START_UNIX + 40000), unixToCore(DAY_START_UNIX + 40000 + 3600), 0);

  // Duration >24h — filtered
  insert.run("/app/usage", "com.apple.Notes", unixToCore(DAY_START_UNIX + 50000), unixToCore(DAY_START_UNIX + 50000 + 90000), 0);

  db.close();
});

afterAll(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

describe("screen-time source", () => {
  test("exports conform to Source interface", () => {
    expect(screenTime.name).toBe("screen-time");
    expect(typeof screenTime.fetchNew).toBe("function");
    expect(typeof createScreenTimeSource).toBe("function");
  });

  test("aggregates usage by date+bundleId with correct durations", async () => {
    const src = createScreenTimeSource({ dbPath });
    const items = await src.fetchNew(new MockSyncState());

    // Expected: Safari day1 (30m), Slack day1 (5m), Safari day2 (15m), MyCoolApp day1 (2m) = 4
    expect(items.length).toBe(4);
    for (const item of items) validateItem(item, "screen-time", /^screen-time-/);

    const byId: Record<string, typeof items[number]> = {};
    for (const it of items) byId[it.externalId] = it;

    const safariDay1 = byId["screen-time-2024-06-15-com.apple.Safari"];
    expect(safariDay1).toBeDefined();
    expect(safariDay1!.metadata.durationMinutes).toBe(30);
    expect(safariDay1!.metadata.sessions).toBe(2);
    expect(safariDay1!.metadata.appName).toBe("Safari");
    expect(safariDay1!.metadata.bundleId).toBe("com.apple.Safari");
    expect(safariDay1!.metadata.date).toBe("2024-06-15");
    expect(safariDay1!.content).toBe("Safari: 30m on 2024-06-15");
    expect(safariDay1!.createdAt).toBe(DAY_START_UNIX);

    const slack = byId["screen-time-2024-06-15-com.tinyspeck.slackmacgap"];
    expect(slack).toBeDefined();
    expect(slack!.metadata.durationMinutes).toBe(5);
    expect(slack!.metadata.sessions).toBe(1);
    expect(slack!.metadata.appName).toBe("Slack");

    const safariDay2 = byId["screen-time-2024-06-16-com.apple.Safari"];
    expect(safariDay2).toBeDefined();
    expect(safariDay2!.metadata.durationMinutes).toBe(15);
    expect(safariDay2!.metadata.sessions).toBe(1);
    expect(safariDay2!.createdAt).toBe(DAY2_START_UNIX);

    const custom = byId["screen-time-2024-06-15-com.example.MyCoolApp"];
    expect(custom).toBeDefined();
    expect(custom!.metadata.appName).toBe("My Cool App");
    expect(custom!.metadata.durationMinutes).toBe(2);

    expect(byId["screen-time-2024-06-15-com.apple.Terminal"]).toBeUndefined();
    expect(byId["screen-time-2024-06-15-com.apple.Notes"]).toBeUndefined();
  });

  test("respects sync cutoff via lastSync", async () => {
    const src = createScreenTimeSource({ dbPath });
    const state = new MockSyncState();
    state.resetSync("screen-time", DAY2_START_UNIX - 1);

    const items = await src.fetchNew(state);
    expect(items.length).toBe(1);
    expect(items[0]!.externalId).toBe("screen-time-2024-06-16-com.apple.Safari");
    expect(items[0]!.metadata.durationMinutes).toBe(15);
  });

  test("CoreData epoch conversion produces correct date buckets", async () => {
    const src = createScreenTimeSource({ dbPath });
    const items = await src.fetchNew(new MockSyncState());
    const dates = new Set(items.map((i) => i.metadata.date as string));
    expect(dates.has("2024-06-15")).toBe(true);
    expect(dates.has("2024-06-16")).toBe(true);
    expect(dates.size).toBe(2);
  });

  test("missing db returns empty array, not a crash", async () => {
    const src = createScreenTimeSource({ dbPath: join(tmpDir, "does-not-exist.db") });
    const items = await src.fetchNew(new MockSyncState());
    expect(items).toEqual([]);
  });

  test.skipIf(!LIVE)("LIVE: reads from real knowledgeC.db", async () => {
    const items = await screenTime.fetchNew(new MockSyncState(), { defaultDays: 7, limit: 10 });
    for (const item of items) validateItem(item, "screen-time", /^screen-time-/);
  }, 60_000);
});
