/**
 * Apple Health — reads health data from the local macOS HealthKit database.
 *
 * On macOS 13+, Health data syncs via iCloud to:
 *   ~/Library/Health/healthdb.sqlite (metadata, samples, quantities)
 *
 * Requires Full Disk Access. Records are aggregated by day.
 */
import { Database } from "bun:sqlite";
import { homedir, tmpdir } from "os";
import { join } from "path";
import { existsSync, copyFileSync, mkdirSync } from "fs";
import type { Source, SyncState, SyncOptions, Item } from "./types";

// Core Data epoch: seconds since 2001-01-01
const CORE_DATA_EPOCH_OFFSET = 978307200;

const HEALTH_DB = join(homedir(), "Library/Health/healthdb.sqlite");
const TEMP_DIR = join(tmpdir(), "kent-apple-health");

// ─── Daily aggregation ──────────────────────────────────────────────────

interface DayBucket {
  date: string; // YYYY-MM-DD
  steps: number;
  distanceKm: number;
  activeCalories: number;
  heartRateSum: number;
  heartRateCount: number;
  weight: number | null;
  weightTimestamp: number;
  sleepHours: number;
  flightsClimbed: number;
}

function emptyBucket(date: string): DayBucket {
  return {
    date,
    steps: 0,
    distanceKm: 0,
    activeCalories: 0,
    heartRateSum: 0,
    heartRateCount: 0,
    weight: null,
    weightTimestamp: 0,
    sleepHours: 0,
    flightsClimbed: 0,
  };
}

function bucketsToItems(buckets: Map<string, DayBucket>, limit: number): Item[] {
  const sortedDays = Array.from(buckets.keys()).sort();
  const items: Item[] = [];

  for (const day of sortedDays) {
    if (items.length >= limit) break;
    const b = buckets.get(day)!;
    const dayTs = Math.floor(new Date(day + "T00:00:00").getTime() / 1000);

    const parts: string[] = [];
    if (b.steps > 0) parts.push(`Steps: ${Math.round(b.steps)}`);
    if (b.distanceKm > 0) parts.push(`Distance: ${b.distanceKm.toFixed(1)} km`);
    if (b.activeCalories > 0) parts.push(`Calories: ${Math.round(b.activeCalories)}`);
    if (b.heartRateCount > 0) parts.push(`Avg HR: ${Math.round(b.heartRateSum / b.heartRateCount)} bpm`);
    if (b.weight !== null) parts.push(`Weight: ${b.weight.toFixed(1)} kg`);
    if (b.sleepHours > 0) parts.push(`Sleep: ${b.sleepHours.toFixed(1)} hrs`);
    if (b.flightsClimbed > 0) parts.push(`Flights: ${Math.round(b.flightsClimbed)}`);

    if (parts.length === 0) continue;

    items.push({
      source: "apple-health",
      externalId: `apple-health-${day}`,
      content: parts.join(" | "),
      metadata: {
        date: day,
        steps: Math.round(b.steps),
        distanceKm: parseFloat(b.distanceKm.toFixed(2)),
        activeCalories: Math.round(b.activeCalories),
        avgHeartRate:
          b.heartRateCount > 0
            ? Math.round(b.heartRateSum / b.heartRateCount)
            : null,
        weight: b.weight !== null ? parseFloat(b.weight.toFixed(1)) : null,
        sleepHours: parseFloat(b.sleepHours.toFixed(1)),
        flightsClimbed: Math.round(b.flightsClimbed),
      },
      createdAt: dayTs,
    });
  }

  return items;
}

// ─── SQLite-based fetcher (primary — reads macOS HealthKit DB) ──────────

// HealthKit data type IDs (these are stable across macOS versions)
const QUANTITY_TYPE_IDS: Record<string, string> = {
  HKQuantityTypeIdentifierStepCount: "steps",
  HKQuantityTypeIdentifierDistanceWalkingRunning: "distance",
  HKQuantityTypeIdentifierActiveEnergyBurned: "calories",
  HKQuantityTypeIdentifierHeartRate: "heartRate",
  HKQuantityTypeIdentifierBodyMass: "weight",
  HKQuantityTypeIdentifierFlightsClimbed: "flights",
};

const CATEGORY_TYPE_IDS: Record<string, string> = {
  HKCategoryTypeIdentifierSleepAnalysis: "sleep",
};

function copyToTemp(srcPath: string, name: string): string | null {
  if (!existsSync(srcPath)) return null;
  mkdirSync(TEMP_DIR, { recursive: true });
  const dest = join(TEMP_DIR, name);
  try {
    copyFileSync(srcPath, dest);
    // Copy WAL and SHM if they exist
    const walPath = srcPath + "-wal";
    const shmPath = srcPath + "-shm";
    if (existsSync(walPath)) copyFileSync(walPath, dest + "-wal");
    if (existsSync(shmPath)) copyFileSync(shmPath, dest + "-shm");
    return dest;
  } catch (e) {
    console.warn(`[apple-health] Failed to copy ${name} to temp: ${e}`);
    return null;
  }
}

function coreDataToDate(coreDataTs: number): Date {
  return new Date((coreDataTs + CORE_DATA_EPOCH_OFFSET) * 1000);
}

function coreDataToDateKey(coreDataTs: number): string {
  return coreDataToDate(coreDataTs).toISOString().slice(0, 10);
}

async function fetchViaSqlite(cutoff: number, limit: number): Promise<Item[]> {
  // Try the main healthdb first
  const tempDb = copyToTemp(HEALTH_DB, "healthdb.sqlite");
  if (!tempDb) return [];

  let db: InstanceType<typeof Database>;
  try {
    db = new Database(tempDb, { readonly: true });
    db.exec("PRAGMA busy_timeout = 5000");
  } catch (e) {
    console.warn(`[apple-health] Failed to open healthdb: ${e}`);
    return [];
  }

  const buckets = new Map<string, DayBucket>();
  const cutoffCoreData = cutoff > 0 ? cutoff - CORE_DATA_EPOCH_OFFSET : 0;

  try {
    // First, get data_type IDs for the types we care about
    const allTypeNames = [...Object.keys(QUANTITY_TYPE_IDS), ...Object.keys(CATEGORY_TYPE_IDS)];
    const placeholders = allTypeNames.map(() => "?").join(",");

    // The samples table links to data_types and quantity_samples
    // Schema: samples(data_id, data_type, start_date, end_date)
    //         quantity_samples(data_id, quantity)
    //         quantity_sample_series(data_id, ...)
    const rows = db.query(`
      SELECT
        s.data_id,
        s.start_date,
        s.end_date,
        dt.data_type as type_name,
        COALESCE(qs.quantity, qss.quantity, 0) as value
      FROM samples s
      JOIN data_types dt ON s.data_type = dt.ROWID
      LEFT JOIN quantity_samples qs ON qs.data_id = s.data_id
      LEFT JOIN quantity_sample_series qss ON qss.data_id = s.data_id
      WHERE dt.data_type IN (${placeholders})
        AND s.start_date > ?
      ORDER BY s.start_date DESC
      LIMIT 50000
    `).all(...allTypeNames, cutoffCoreData) as Array<{
      data_id: number;
      start_date: number;
      end_date: number;
      type_name: string;
      value: number;
    }>;

    db.close();

    for (const row of rows) {
      const day = coreDataToDateKey(row.start_date);
      let bucket = buckets.get(day);
      if (!bucket) {
        bucket = emptyBucket(day);
        buckets.set(day, bucket);
      }

      const startTs = row.start_date + CORE_DATA_EPOCH_OFFSET;
      const endTs = row.end_date + CORE_DATA_EPOCH_OFFSET;

      switch (row.type_name) {
        case "HKQuantityTypeIdentifierStepCount":
          bucket.steps += row.value;
          break;
        case "HKQuantityTypeIdentifierDistanceWalkingRunning":
          // HealthKit stores distance in meters in the DB
          bucket.distanceKm += row.value / 1000;
          break;
        case "HKQuantityTypeIdentifierActiveEnergyBurned":
          // HealthKit stores energy in kcal in the DB
          bucket.activeCalories += row.value;
          break;
        case "HKQuantityTypeIdentifierHeartRate":
          // HealthKit stores heart rate in count/s — convert to BPM
          bucket.heartRateSum += row.value * 60;
          bucket.heartRateCount += 1;
          break;
        case "HKQuantityTypeIdentifierBodyMass":
          // HealthKit stores mass in kg
          if (startTs > bucket.weightTimestamp) {
            bucket.weight = row.value;
            bucket.weightTimestamp = startTs;
          }
          break;
        case "HKQuantityTypeIdentifierFlightsClimbed":
          bucket.flightsClimbed += row.value;
          break;
        case "HKCategoryTypeIdentifierSleepAnalysis":
          if (endTs > startTs) {
            bucket.sleepHours += (endTs - startTs) / 3600;
          }
          break;
      }
    }
  } catch (e) {
    db.close();
    throw e;
  }

  return bucketsToItems(buckets, limit);
}

// ─── Source implementation ───────────────────────────────────────────────

export const appleHealth: Source = {
  name: "apple-health",

  async fetchNew(state: SyncState, options?: SyncOptions): Promise<Item[]> {
    const lastSync = state.getLastSync("apple-health");
    const now = Math.floor(Date.now() / 1000);
    const defaultDays = options?.defaultDays ?? 365;
    const cutoff =
      lastSync > 0
        ? lastSync
        : defaultDays === 0
          ? 0
          : now - defaultDays * 86400;
    const limit = options?.limit ?? 5000;

    if (!existsSync(HEALTH_DB)) {
      console.warn("[apple-health] ~/Library/Health/healthdb.sqlite not found — enable Health sync in iCloud settings");
      return [];
    }

    try {
      return await fetchViaSqlite(cutoff, limit);
    } catch (e) {
      console.warn(`[apple-health] Failed to read HealthKit database: ${e}`);
      return [];
    }
  },
};
