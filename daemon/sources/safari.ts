/**
 * Safari browsing history source — reads local Safari browsing history.
 *
 * Safari stores history in a SQLite database at:
 *   ~/Library/Safari/History.db
 *
 * The database is locked while Safari runs, so we copy it to /tmp first.
 * Safari uses Core Data timestamps: seconds since 2001-01-01.
 *   Convert to Unix: unix_seconds = core_data_time + 978307200
 */
import { Database } from "bun:sqlite";
import { join } from "path";
import { homedir, tmpdir } from "os";
import { existsSync, copyFileSync, mkdirSync } from "fs";
import type { Source, SyncState, SyncOptions, Item } from "./types";

const SAFARI_HISTORY_DB = join(homedir(), "Library/Safari/History.db");
const TEMP_DIR = join(tmpdir(), "kent-safari");

// Core Data epoch: seconds since Jan 1, 2001
// Offset to convert to Unix timestamp (seconds since Jan 1, 1970)
const CORE_DATA_EPOCH_OFFSET = 978307200;

function coreDataTimeToUnix(coreDataTime: number): number {
  return Math.floor(coreDataTime + CORE_DATA_EPOCH_OFFSET);
}

function unixToCoreDataTime(unixTime: number): number {
  return unixTime - CORE_DATA_EPOCH_OFFSET;
}

/** Copy the Safari History.db (and WAL/SHM files) to a temp directory */
function copyDbToTemp(): string | null {
  if (!existsSync(SAFARI_HISTORY_DB)) return null;
  mkdirSync(TEMP_DIR, { recursive: true });

  const dest = join(TEMP_DIR, "History.db");
  try {
    copyFileSync(SAFARI_HISTORY_DB, dest);

    // Copy WAL and SHM files if they exist — needed for consistent reads
    const walPath = SAFARI_HISTORY_DB + "-wal";
    const shmPath = SAFARI_HISTORY_DB + "-shm";
    if (existsSync(walPath)) {
      copyFileSync(walPath, join(TEMP_DIR, "History.db-wal"));
    }
    if (existsSync(shmPath)) {
      copyFileSync(shmPath, join(TEMP_DIR, "History.db-shm"));
    }

    return dest;
  } catch (e) {
    console.warn(`[safari] Failed to copy History.db to temp: ${e}`);
    return null;
  }
}

/** Simple domain categorization */
function categorizeDomain(url: string): string {
  try {
    const domain = new URL(url).hostname;
    const categories: Record<string, string[]> = {
      work: [
        "github.com", "gitlab.com", "bitbucket.org", "linear.app", "notion.so",
        "figma.com", "slack.com", "vercel.com", "netlify.com",
        "docs.google.com", "sheets.google.com", "drive.google.com",
      ],
      communication: [
        "mail.google.com", "outlook.live.com", "outlook.office.com",
        "discord.com", "web.whatsapp.com", "messages.google.com",
      ],
      social: [
        "twitter.com", "x.com", "linkedin.com", "facebook.com",
        "instagram.com", "reddit.com", "threads.net",
      ],
      ai: [
        "chat.openai.com", "chatgpt.com", "claude.ai", "bard.google.com",
        "perplexity.ai", "v0.dev", "cursor.sh",
      ],
    };
    for (const [category, domains] of Object.entries(categories)) {
      if (domains.some((d) => domain.includes(d))) return category;
    }
    return "other";
  } catch {
    return "other";
  }
}

export interface SafariSourceConfig {
  /** Explicit path to a Safari History.db. If provided, skips the copy-to-temp dance. */
  historyDbPath?: string;
  /** Clock injection for deterministic tests. Returns unix seconds. */
  now?: () => number;
}

export function createSafariSource(config: SafariSourceConfig = {}): Source {
  return {
  name: "safari",

  async fetchNew(state: SyncState, options?: SyncOptions): Promise<Item[]> {
    try {
      const dbPath = config.historyDbPath
        ? (existsSync(config.historyDbPath) ? config.historyDbPath : null)
        : copyDbToTemp();
      if (!dbPath) {
        console.warn("[safari] Safari History.db not found, skipping");
        return [];
      }

      const lastSync = state.getLastSync("safari");
      const lastSyncCoreData =
        lastSync > 0 ? unixToCoreDataTime(lastSync) : 0;

      const limit = options?.limit ?? 5000;
      const items: Item[] = [];

      const db = new Database(dbPath, { readonly: true });

      try {
        const rows = db
          .query(
            `
            SELECT
              hi.id,
              hi.url,
              hi.domain_expansion,
              hi.visit_count,
              hv.visit_time,
              hv.title
            FROM history_visits hv
            JOIN history_items hi ON hv.history_item = hi.id
            WHERE hv.visit_time > ?
            ORDER BY hv.visit_time DESC
            LIMIT ?
            `
          )
          .all(lastSyncCoreData, limit) as any[];

        const seenUrls = new Set<string>();

        for (const row of rows) {
          if (seenUrls.has(row.url)) continue;
          seenUrls.add(row.url);

          const unixTime = coreDataTimeToUnix(row.visit_time);

          items.push({
            source: "safari",
            externalId: `safari-history-${row.id}-${row.visit_time}`,
            content: `${row.title || "Untitled"}\n${row.url}`,
            metadata: {
              type: "history",
              url: row.url,
              title: row.title,
              visitCount: row.visit_count,
              domain: row.domain_expansion,
              category: categorizeDomain(row.url),
            },
            createdAt: unixTime,
          });

          if (options?.onProgress) {
            options.onProgress(items.length);
          }
        }
      } finally {
        db.close();
      }

      return items;
    } catch (e) {
      console.warn(`[safari] Failed to fetch data: ${e}`);
      return [];
    }
  },
  };
}

export const safari: Source = createSafariSource();
