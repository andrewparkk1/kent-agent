/**
 * macOS Screen Time / app usage source — reads app usage data from the
 * Knowledge store SQLite database.
 *
 * macOS tracks app usage in:
 *   ~/Library/Application Support/Knowledge/knowledgeC.db
 *
 * The database may be locked, so we copy it (plus WAL/SHM) to /tmp first.
 * Timestamps are Core Data format: seconds since 2001-01-01.
 *   Convert to Unix: unix_seconds = core_data_time + 978307200
 */
import { Database } from "bun:sqlite";
import { join } from "path";
import { homedir, tmpdir } from "os";
import { existsSync, copyFileSync, mkdirSync } from "fs";
import type { Source, SyncState, SyncOptions, Item } from "./types";

const KNOWLEDGE_DB = join(
  homedir(),
  "Library/Application Support/Knowledge/knowledgeC.db"
);
const TEMP_DIR = join(tmpdir(), "kent-screen-time");

// Core Data epoch offset: seconds between 1970-01-01 and 2001-01-01
const CORE_DATA_EPOCH_OFFSET = 978307200;

function coreDataTimeToUnix(coreDataTime: number): number {
  return Math.floor(coreDataTime + CORE_DATA_EPOCH_OFFSET);
}

function unixToCoreDataTime(unixTime: number): number {
  return unixTime - CORE_DATA_EPOCH_OFFSET;
}

/** Copy the Knowledge DB (and WAL/SHM files) to a temp directory */
function copyDbToTemp(): string | null {
  if (!existsSync(KNOWLEDGE_DB)) return null;
  mkdirSync(TEMP_DIR, { recursive: true });

  const dest = join(TEMP_DIR, "knowledgeC.db");
  try {
    copyFileSync(KNOWLEDGE_DB, dest);

    // Copy WAL and SHM files if they exist — needed for consistent reads
    const walPath = KNOWLEDGE_DB + "-wal";
    const shmPath = KNOWLEDGE_DB + "-shm";
    if (existsSync(walPath)) {
      copyFileSync(walPath, join(TEMP_DIR, "knowledgeC.db-wal"));
    }
    if (existsSync(shmPath)) {
      copyFileSync(shmPath, join(TEMP_DIR, "knowledgeC.db-shm"));
    }

    return dest;
  } catch (e) {
    console.warn(`[screen-time] Failed to copy knowledgeC.db to temp: ${e}`);
    return null;
  }
}

/** Map of common bundle IDs to human-readable app names */
const BUNDLE_NAME_MAP: Record<string, string> = {
  "com.apple.Safari": "Safari",
  "com.apple.mail": "Mail",
  "com.apple.MobileSMS": "Messages",
  "com.apple.iChat": "Messages",
  "com.apple.MobileNotes": "Notes",
  "com.apple.Notes": "Notes",
  "com.apple.reminders": "Reminders",
  "com.apple.iCal": "Calendar",
  "com.apple.AddressBook": "Contacts",
  "com.apple.finder": "Finder",
  "com.apple.Preview": "Preview",
  "com.apple.Terminal": "Terminal",
  "com.apple.dt.Xcode": "Xcode",
  "com.apple.systempreferences": "System Settings",
  "com.apple.Preferences": "System Settings",
  "com.apple.AppStore": "App Store",
  "com.apple.Photos": "Photos",
  "com.apple.Music": "Music",
  "com.apple.podcasts": "Podcasts",
  "com.apple.news": "News",
  "com.apple.Maps": "Maps",
  "com.apple.FaceTime": "FaceTime",
  "com.apple.TextEdit": "TextEdit",
  "com.apple.ActivityMonitor": "Activity Monitor",
  "com.apple.KeychainAccess": "Keychain Access",
  "com.apple.ScreenSharing": "Screen Sharing",
  "com.apple.QuickTimePlayerX": "QuickTime Player",
  "com.google.Chrome": "Chrome",
  "com.google.Chrome.canary": "Chrome Canary",
  "org.mozilla.firefox": "Firefox",
  "com.microsoft.VSCode": "VS Code",
  "com.microsoft.Word": "Word",
  "com.microsoft.Excel": "Excel",
  "com.microsoft.Powerpoint": "PowerPoint",
  "com.microsoft.Outlook": "Outlook",
  "com.microsoft.teams2": "Teams",
  "com.microsoft.teams": "Teams",
  "com.tinyspeck.slackmacgap": "Slack",
  "com.hnc.Discord": "Discord",
  "net.whatsapp.WhatsApp": "WhatsApp",
  "com.spotify.client": "Spotify",
  "com.figma.Desktop": "Figma",
  "md.obsidian": "Obsidian",
  "com.linear": "Linear",
  "com.notion.id": "Notion",
  "dev.warp.Warp-Stable": "Warp",
  "com.googlecode.iterm2": "iTerm2",
  "com.todesktop.230313mzl4w4u92": "Cursor",
  "com.openai.chat": "ChatGPT",
  "com.1password.1password": "1Password",
  "com.raycast.macos": "Raycast",
  "com.culturedcode.ThingsMac": "Things",
  "com.todoist.mac.Todoist": "Todoist",
  "com.readdle.smartemail-Mac": "Spark",
  "com.freron.MailMate": "MailMate",
  "com.brave.Browser": "Brave",
  "company.thebrowser.Browser": "Arc",
  "com.apple.Safari.WebApp": "Safari Web App",
};

/** Convert a bundle ID to a readable app name */
function bundleIdToName(bundleId: string): string {
  if (BUNDLE_NAME_MAP[bundleId]) return BUNDLE_NAME_MAP[bundleId];

  // Try to extract a readable name from the bundle ID itself
  // e.g., "com.example.MyApp" -> "MyApp"
  const parts = bundleId.split(".");
  const last = parts[parts.length - 1];
  if (last) {
    // Add spaces before capitals: "MyApp" -> "My App"
    return last.replace(/([a-z])([A-Z])/g, "$1 $2");
  }
  return bundleId;
}

/** Format a date as YYYY-MM-DD */
function formatDate(unixTimestamp: number, gmtOffsetSeconds: number): string {
  // Apply timezone offset to get local time
  const localMs = (unixTimestamp + gmtOffsetSeconds) * 1000;
  const d = new Date(localMs);
  const year = d.getUTCFullYear();
  const month = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/** Get the start-of-day unix timestamp for a given date string */
function dateToUnix(dateStr: string): number {
  return Math.floor(new Date(dateStr + "T00:00:00Z").getTime() / 1000);
}

interface RawRow {
  Z_PK: number;
  ZSTREAMNAME: string;
  ZVALUESTRING: string;
  ZSTARTDATE: number;
  ZENDDATE: number;
  ZSECONDSFROMGMT: number;
}

interface AggregatedUsage {
  date: string;
  bundleId: string;
  appName: string;
  totalSeconds: number;
  sessions: number;
}

export interface ScreenTimeConfig {
  /** Override knowledgeC.db path. When set, file is opened directly (no /tmp copy). */
  dbPath?: string;
  now?: () => number;
}

export function createScreenTimeSource(config: ScreenTimeConfig = {}): Source {
  return {
    name: "screen-time",

    async fetchNew(state: SyncState, options?: SyncOptions): Promise<Item[]> {
    try {
      const dbPath = config.dbPath ?? copyDbToTemp();
      if (!dbPath) {
        console.warn(
          "[screen-time] knowledgeC.db not found, skipping"
        );
        return [];
      }

      const lastSync = state.getLastSync("screen-time");
      const lastSyncCoreData =
        lastSync > 0 ? unixToCoreDataTime(lastSync) : 0;

      const db = new Database(dbPath, { readonly: true });

      try {
        const rows = db
          .query(
            `
            SELECT Z_PK, ZSTREAMNAME, ZVALUESTRING, ZSTARTDATE, ZENDDATE, ZSECONDSFROMGMT
            FROM ZOBJECT
            WHERE ZSTREAMNAME IN ('/app/usage', '/app/inFocus')
              AND ZSTARTDATE > ?
            ORDER BY ZSTARTDATE DESC
            LIMIT 5000
            `
          )
          .all(lastSyncCoreData) as RawRow[];

        // Aggregate by date + app
        const aggregation = new Map<string, AggregatedUsage>();

        for (const row of rows) {
          if (!row.ZVALUESTRING || row.ZSTARTDATE == null || row.ZENDDATE == null) {
            continue;
          }

          const startUnix = coreDataTimeToUnix(row.ZSTARTDATE);
          const endUnix = coreDataTimeToUnix(row.ZENDDATE);
          const duration = endUnix - startUnix;

          // Skip invalid durations (negative or unreasonably long — over 24h)
          if (duration <= 0 || duration > 86400) continue;

          const gmtOffset = row.ZSECONDSFROMGMT || 0;
          const date = formatDate(startUnix, gmtOffset);
          const bundleId = row.ZVALUESTRING;
          const key = `${date}-${bundleId}`;

          const existing = aggregation.get(key);
          if (existing) {
            existing.totalSeconds += duration;
            existing.sessions += 1;
          } else {
            aggregation.set(key, {
              date,
              bundleId,
              appName: bundleIdToName(bundleId),
              totalSeconds: duration,
              sessions: 1,
            });
          }
        }

        const items: Item[] = [];

        for (const usage of aggregation.values()) {
          const durationMinutes = Math.round(usage.totalSeconds / 60);

          // Skip very short usage (less than 1 minute)
          if (durationMinutes < 1) continue;

          items.push({
            source: "screen-time",
            externalId: `screen-time-${usage.date}-${usage.bundleId}`,
            content: `${usage.appName}: ${durationMinutes}m on ${usage.date}`,
            metadata: {
              date: usage.date,
              appName: usage.appName,
              bundleId: usage.bundleId,
              durationMinutes,
              sessions: usage.sessions,
            },
            createdAt: dateToUnix(usage.date),
          });

          if (options?.onProgress) {
            options.onProgress(items.length);
          }
        }

        return items;
      } finally {
        db.close();
      }
    } catch (e) {
      console.warn(`[screen-time] Failed to fetch data: ${e}`);
      return [];
    }
    },
  };
}

export const screenTime: Source = createScreenTimeSource();
