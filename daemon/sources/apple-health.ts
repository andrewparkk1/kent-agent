/**
 * Apple Health — reads health data from an Apple Health XML export.
 *
 * Export discovery order:
 * 1. APPLE_HEALTH_EXPORT_PATH env var (explicit override)
 * 2. ~/.kent/health/export.xml (recommended location)
 *
 * The XML export is typically large, so we parse it line-by-line with regex
 * rather than loading a full DOM. Records are aggregated by day to keep
 * the item count manageable.
 */
import { homedir } from "os";
import { join } from "path";
import { existsSync } from "fs";
import type { Source, SyncState, SyncOptions, Item } from "./types";

// ---------------------------------------------------------------------------
// Tracked metric types
// ---------------------------------------------------------------------------

const METRIC_TYPES = new Set([
  "HKQuantityTypeIdentifierStepCount",
  "HKQuantityTypeIdentifierDistanceWalkingRunning",
  "HKQuantityTypeIdentifierActiveEnergyBurned",
  "HKQuantityTypeIdentifierHeartRate",
  "HKQuantityTypeIdentifierBodyMass",
  "HKCategoryTypeIdentifierSleepAnalysis",
  "HKQuantityTypeIdentifierFlightsClimbed",
]);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Extract an XML attribute value by name from a tag string. */
function attr(tag: string, name: string): string | null {
  // Match name="value" allowing for single or double quotes
  const re = new RegExp(`${name}="([^"]*)"`, "i");
  const m = tag.match(re);
  return m ? m[1] : null;
}

/**
 * Parse an Apple Health date string like "2024-01-01 10:00:00 -0700"
 * into a Unix timestamp (seconds).
 */
function parseHealthDate(dateStr: string): number {
  // Replace the space before the timezone offset with 'T' and normalize
  // "2024-01-01 10:00:00 -0700" -> "2024-01-01T10:00:00-0700"
  // We need to handle the space between time and timezone
  const parts = dateStr.trim().split(" ");
  if (parts.length >= 3) {
    const iso = `${parts[0]}T${parts[1]}${parts[2]}`;
    const d = new Date(iso);
    if (!isNaN(d.getTime())) return Math.floor(d.getTime() / 1000);
  }
  // Fallback: try direct parse
  const d = new Date(dateStr);
  return isNaN(d.getTime()) ? 0 : Math.floor(d.getTime() / 1000);
}

/** Extract the YYYY-MM-DD date string from a health date. */
function dateKey(dateStr: string): string {
  return dateStr.trim().slice(0, 10);
}

// ---------------------------------------------------------------------------
// Daily aggregation
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Export discovery
// ---------------------------------------------------------------------------

function findExportPath(): string | null {
  // 1. Env var override
  const envPath = process.env.APPLE_HEALTH_EXPORT_PATH;
  if (envPath && existsSync(envPath)) {
    return envPath;
  }

  // 2. Standard location
  const standardPath = join(homedir(), ".kent", "health", "export.xml");
  if (existsSync(standardPath)) {
    return standardPath;
  }

  return null;
}

// ---------------------------------------------------------------------------
// Source implementation
// ---------------------------------------------------------------------------

/** Regex to match self-closing <Record .../> elements across one or more lines. */
const RECORD_RE = /<Record\s+[^>]*\/>/g;

export const appleHealth: Source = {
  name: "apple-health",

  async fetchNew(state: SyncState, options?: SyncOptions): Promise<Item[]> {
    const exportPath = findExportPath();
    if (!exportPath) {
      return [];
    }

    const lastSync = state.getLastSync("apple-health");
    const now = Math.floor(Date.now() / 1000);
    const defaultDays = options?.defaultDays ?? 365;
    const cutoff =
      lastSync > 0
        ? lastSync
        : defaultDays === 0
          ? 0
          : now - defaultDays * 86400;

    // Read the full file text — Apple Health exports can be large but
    // we process via regex rather than a DOM parser.
    let xml: string;
    try {
      xml = await Bun.file(exportPath).text();
    } catch {
      return [];
    }

    // Aggregate records into day buckets
    const buckets = new Map<string, DayBucket>();
    let highWaterMark = 0;
    let progressCount = 0;

    let match: RegExpExecArray | null;
    while ((match = RECORD_RE.exec(xml)) !== null) {
      const tag = match[0];
      const type = attr(tag, "type");
      if (!type || !METRIC_TYPES.has(type)) continue;

      const startDateStr = attr(tag, "startDate");
      if (!startDateStr) continue;

      const startTs = parseHealthDate(startDateStr);
      if (startTs <= cutoff) continue;

      const day = dateKey(startDateStr);
      let bucket = buckets.get(day);
      if (!bucket) {
        bucket = emptyBucket(day);
        buckets.set(day, bucket);
      }

      const value = parseFloat(attr(tag, "value") ?? "0");

      switch (type) {
        case "HKQuantityTypeIdentifierStepCount":
          bucket.steps += value;
          break;

        case "HKQuantityTypeIdentifierDistanceWalkingRunning": {
          // Value is typically in km; some exports use mi — we store as km.
          const unit = attr(tag, "unit");
          if (unit === "mi") {
            bucket.distanceKm += value * 1.60934;
          } else {
            bucket.distanceKm += value;
          }
          break;
        }

        case "HKQuantityTypeIdentifierActiveEnergyBurned": {
          // Value may be kcal or Cal (same thing) or kJ
          const unit = attr(tag, "unit");
          if (unit === "kJ") {
            bucket.activeCalories += value / 4.184;
          } else {
            bucket.activeCalories += value;
          }
          break;
        }

        case "HKQuantityTypeIdentifierHeartRate":
          bucket.heartRateSum += value;
          bucket.heartRateCount += 1;
          break;

        case "HKQuantityTypeIdentifierBodyMass": {
          // Keep the latest weight reading per day
          if (startTs > bucket.weightTimestamp) {
            const unit = attr(tag, "unit");
            if (unit === "lb") {
              bucket.weight = value * 0.453592;
            } else {
              bucket.weight = value;
            }
            bucket.weightTimestamp = startTs;
          }
          break;
        }

        case "HKCategoryTypeIdentifierSleepAnalysis": {
          // Duration in hours from startDate to endDate
          const endDateStr = attr(tag, "endDate");
          if (endDateStr) {
            const endTs = parseHealthDate(endDateStr);
            if (endTs > startTs) {
              bucket.sleepHours += (endTs - startTs) / 3600;
            }
          }
          break;
        }

        case "HKQuantityTypeIdentifierFlightsClimbed":
          bucket.flightsClimbed += value;
          break;
      }

      if (startTs > highWaterMark) {
        highWaterMark = startTs;
      }

      progressCount++;
      if (options?.onProgress && progressCount % 1000 === 0) {
        options.onProgress(progressCount);
      }
    }

    // Convert buckets to items, sorted by date
    const limit = options?.limit ?? 5000;
    const sortedDays = Array.from(buckets.keys()).sort();
    const items: Item[] = [];

    for (const day of sortedDays) {
      if (items.length >= limit) break;

      const b = buckets.get(day)!;
      const dayTs = Math.floor(new Date(day + "T00:00:00").getTime() / 1000);

      // Build content summary
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

    if (options?.onProgress && progressCount > 0) {
      options.onProgress(progressCount);
    }

    return items;
  },
};
