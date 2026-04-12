import { test, expect, describe, beforeAll, afterAll } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { MockSyncState, validateItem, LIVE } from "./_helpers.ts";
import {
  appleHealth,
  createAppleHealthSource,
  _CORE_DATA_EPOCH_OFFSET,
} from "@daemon/sources/apple-health.ts";

// ─── Fixture DB builder ──────────────────────────────────────────────────

interface FixtureSample {
  type: string;
  /** YYYY-MM-DD (used to compute Core-Data start_date at 12:00 local) */
  day: string;
  /** Quantity value (steps, meters, kcal, count/s for HR, kg, flights) */
  value: number;
  /** Sleep end time offset in hours (ignored unless type is sleep) */
  endOffsetHours?: number;
}

function unixToCoreData(unix: number): number {
  return unix - _CORE_DATA_EPOCH_OFFSET;
}

function buildFixtureDb(path: string, samples: FixtureSample[]) {
  const db = new Database(path, { create: true });
  try {
    db.run(
      "CREATE TABLE data_types (ROWID INTEGER PRIMARY KEY AUTOINCREMENT, data_type TEXT NOT NULL UNIQUE)",
    );
    db.run(
      "CREATE TABLE samples (data_id INTEGER PRIMARY KEY AUTOINCREMENT, data_type INTEGER NOT NULL, start_date REAL NOT NULL, end_date REAL NOT NULL)",
    );
    db.run(
      "CREATE TABLE quantity_samples (data_id INTEGER PRIMARY KEY, quantity REAL)",
    );
    db.run(
      "CREATE TABLE quantity_sample_series (data_id INTEGER PRIMARY KEY, quantity REAL)",
    );

    const allTypes = Array.from(new Set(samples.map((s) => s.type)));
    const insertType = db.prepare("INSERT INTO data_types (data_type) VALUES (?)");
    const typeIds = new Map<string, number>();
    for (const t of allTypes) {
      const info = insertType.run(t);
      typeIds.set(t, Number(info.lastInsertRowid));
    }

    const insertSample = db.prepare(
      "INSERT INTO samples (data_type, start_date, end_date) VALUES (?, ?, ?)",
    );
    const insertQuantity = db.prepare(
      "INSERT INTO quantity_samples (data_id, quantity) VALUES (?, ?)",
    );

    for (const s of samples) {
      // Noon on the given day in local time
      const startUnix = Math.floor(new Date(s.day + "T12:00:00").getTime() / 1000);
      const startCore = unixToCoreData(startUnix);
      const endCore =
        s.endOffsetHours != null
          ? unixToCoreData(startUnix + s.endOffsetHours * 3600)
          : startCore;
      const info = insertSample.run(typeIds.get(s.type)!, startCore, endCore);
      insertQuantity.run(Number(info.lastInsertRowid), s.value);
    }
  } finally {
    db.close();
  }
}

// ─── Suite ───────────────────────────────────────────────────────────────

let tmpDir: string;
let fixturePath: string;
let sparsePath: string;
let emptyPath: string;

beforeAll(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "kent-health-test-"));
  fixturePath = join(tmpDir, "healthdb.sqlite");
  sparsePath = join(tmpDir, "sparse.sqlite");
  emptyPath = join(tmpDir, "empty.sqlite");

  buildFixtureDb(fixturePath, [
    // Day 1 — full day
    { type: "HKQuantityTypeIdentifierStepCount", day: "2025-06-08", value: 5000 },
    { type: "HKQuantityTypeIdentifierStepCount", day: "2025-06-08", value: 3200 },
    { type: "HKQuantityTypeIdentifierDistanceWalkingRunning", day: "2025-06-08", value: 6500 }, // meters
    { type: "HKQuantityTypeIdentifierActiveEnergyBurned", day: "2025-06-08", value: 250.4 },
    // HR stored as count/s -> 1.2 count/s = 72 bpm; 1.3 = 78 bpm -> avg 75
    { type: "HKQuantityTypeIdentifierHeartRate", day: "2025-06-08", value: 1.2 },
    { type: "HKQuantityTypeIdentifierHeartRate", day: "2025-06-08", value: 1.3 },
    { type: "HKQuantityTypeIdentifierBodyMass", day: "2025-06-08", value: 72.5 },
    { type: "HKQuantityTypeIdentifierFlightsClimbed", day: "2025-06-08", value: 12 },
    {
      type: "HKCategoryTypeIdentifierSleepAnalysis",
      day: "2025-06-08",
      value: 0,
      endOffsetHours: 7.5,
    },

    // Day 2 — steps only
    { type: "HKQuantityTypeIdentifierStepCount", day: "2025-06-09", value: 8888 },

    // Day 3 — distance only
    { type: "HKQuantityTypeIdentifierDistanceWalkingRunning", day: "2025-06-10", value: 2500 },
  ]);

  buildFixtureDb(sparsePath, [
    { type: "HKQuantityTypeIdentifierStepCount", day: "2025-06-08", value: 100 },
  ]);

  // Empty — valid schema, zero rows
  buildFixtureDb(emptyPath, []);
});

afterAll(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

describe("apple-health source", () => {
  test("exports stable name and factory", () => {
    expect(appleHealth.name).toBe("apple-health");
    expect(typeof appleHealth.fetchNew).toBe("function");
    expect(typeof createAppleHealthSource).toBe("function");
  });

  test("aggregates fixture sqlite into daily items", async () => {
    const src = createAppleHealthSource({
      dbPath: fixturePath,
      now: () => Date.parse("2025-06-11T00:00:00Z"),
    });
    const items = await src.fetchNew(new MockSyncState(), { defaultDays: 30 });

    expect(items).toHaveLength(3);
    for (const item of items) validateItem(item, "apple-health", /^apple-health-\d{4}-\d{2}-\d{2}$/);

    const byDay = new Map(items.map((i) => [i.metadata.date as string, i]));
    const day1 = byDay.get("2025-06-08")!;
    const day2 = byDay.get("2025-06-09")!;
    const day3 = byDay.get("2025-06-10")!;

    expect(day1).toBeDefined();
    expect(day1.externalId).toBe("apple-health-2025-06-08");
    expect(day1.metadata.steps).toBe(8200); // 5000 + 3200
    expect(day1.metadata.distanceKm).toBe(6.5); // 6500 m -> 6.5 km
    expect(day1.metadata.activeCalories).toBe(250); // rounded
    expect(day1.metadata.avgHeartRate).toBe(75); // (72 + 78) / 2
    expect(day1.metadata.weight).toBe(72.5);
    expect(day1.metadata.flightsClimbed).toBe(12);
    expect(day1.metadata.sleepHours).toBe(7.5);
    expect(day1.content).toContain("Steps: 8200");
    expect(day1.content).toContain("Distance: 6.5 km");
    expect(day1.content).toContain("Calories: 250");
    expect(day1.content).toContain("Avg HR: 75 bpm");
    expect(day1.content).toContain("Weight: 72.5 kg");
    expect(day1.content).toContain("Sleep: 7.5 hrs");
    expect(day1.content).toContain("Flights: 12");
    expect(day1.createdAt).toBe(
      Math.floor(new Date("2025-06-08T00:00:00").getTime() / 1000),
    );

    expect(day2.metadata.steps).toBe(8888);
    expect(day2.metadata.distanceKm).toBe(0);
    expect(day2.metadata.avgHeartRate).toBeNull();
    expect(day2.content).toBe("Steps: 8888");

    expect(day3.metadata.distanceKm).toBe(2.5);
    expect(day3.metadata.steps).toBe(0);
    expect(day3.content).toBe("Distance: 2.5 km");
  });

  test("sparse db yields one item", async () => {
    const src = createAppleHealthSource({
      dbPath: sparsePath,
      now: () => Date.parse("2025-06-11T00:00:00Z"),
    });
    const items = await src.fetchNew(new MockSyncState(), { defaultDays: 30 });
    expect(items).toHaveLength(1);
    expect(items[0]!.metadata.steps).toBe(100);
  });

  test("empty db yields no items", async () => {
    const src = createAppleHealthSource({
      dbPath: emptyPath,
      now: () => Date.parse("2025-06-11T00:00:00Z"),
    });
    const items = await src.fetchNew(new MockSyncState(), { defaultDays: 30 });
    expect(items).toEqual([]);
  });

  test("respects limit option", async () => {
    const src = createAppleHealthSource({
      dbPath: fixturePath,
      now: () => Date.parse("2025-06-11T00:00:00Z"),
    });
    const items = await src.fetchNew(new MockSyncState(), {
      defaultDays: 30,
      limit: 2,
    });
    expect(items).toHaveLength(2);
  });

  test("missing dbPath returns [] gracefully", async () => {
    const src = createAppleHealthSource({
      dbPath: join(tmpDir, "does-not-exist.sqlite"),
    });
    const items = await src.fetchNew(new MockSyncState());
    expect(items).toEqual([]);
  });

  test("cutoff filters out old samples via last sync", async () => {
    const src = createAppleHealthSource({
      dbPath: fixturePath,
      now: () => Date.parse("2025-06-11T00:00:00Z"),
    });
    const state = new MockSyncState();
    // Only include samples whose start_date > 2025-06-09T18:00 UTC
    state.resetSync(
      "apple-health",
      Math.floor(Date.parse("2025-06-09T18:00:00Z") / 1000),
    );
    const items = await src.fetchNew(state);
    const days = items.map((i) => i.metadata.date).sort();
    expect(days).toEqual(["2025-06-10"]);
  });

  test.skipIf(!LIVE)("LIVE: exported appleHealth returns an array", async () => {
    const items = await appleHealth.fetchNew(new MockSyncState(), { defaultDays: 7 });
    expect(Array.isArray(items)).toBe(true);
  }, 60_000);
});
