/**
 * Chrome time tracking — reads local Chrome browsing history, search terms,
 * bookmarks, downloads, and top sites.
 *
 * Chrome stores history in a SQLite database at:
 *   ~/Library/Application Support/Google/Chrome/<Profile>/History
 *
 * The database is locked while Chrome runs, so we copy it to /tmp first.
 * Chrome epoch: microseconds since 1601-01-01.
 *   Convert to Unix: unix_seconds = (chrome_epoch / 1_000_000) - 11644473600
 */
import { Database } from "bun:sqlite";
import { join } from "path";
import { homedir, tmpdir } from "os";
import {
  copyFileSync,
  existsSync,
  readFileSync,
  mkdirSync,
  readdirSync,
} from "fs";
import type { Source, SyncState, SyncOptions, Item } from "./types";

const CHROME_BASE = join(
  homedir(),
  "Library/Application Support/Google/Chrome"
);
const TEMP_DIR = join(tmpdir(), "kent-chrome");

// Chrome epoch: microseconds since Jan 1, 1601
const CHROME_EPOCH_OFFSET = 11644473600n;

function chromeTimeToUnix(chromeTime: number | bigint): number {
  const microseconds = BigInt(chromeTime);
  const seconds = microseconds / 1000000n;
  return Number(seconds - CHROME_EPOCH_OFFSET);
}

/** Find all Chrome profile History paths (multi-profile support) */
function getAllProfileHistoryPaths(): string[] {
  const paths: string[] = [];
  try {
    if (!existsSync(CHROME_BASE)) return paths;

    const entries = readdirSync(CHROME_BASE, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      // Skip non-profile dirs
      if (
        entry.name === "Crashpad" ||
        entry.name === "SwReporter" ||
        entry.name === "System Profile" ||
        entry.name === "Guest Profile"
      )
        continue;

      const histPath = join(CHROME_BASE, entry.name, "History");
      if (existsSync(histPath)) {
        paths.push(histPath);
      }
    }
  } catch {
    // ignore
  }

  // Fallback to Default if nothing found
  const defaultHist = join(CHROME_BASE, "Default", "History");
  if (paths.length === 0 && existsSync(defaultHist)) {
    paths.push(defaultHist);
  }
  return paths;
}

function copyToTemp(srcPath: string, name: string): string | null {
  if (!existsSync(srcPath)) return null;
  mkdirSync(TEMP_DIR, { recursive: true });
  const dest = join(TEMP_DIR, name);
  try {
    copyFileSync(srcPath, dest);
    return dest;
  } catch (e) {
    console.warn(`[chrome] Failed to copy ${name} to temp: ${e}`);
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

export const chrome: Source = {
  name: "chrome",

  async fetchNew(state: SyncState, options?: SyncOptions): Promise<Item[]> {
    try {
      const historyPaths = getAllProfileHistoryPaths();
      if (historyPaths.length === 0) {
        console.warn("[chrome] Chrome profile directory not found, skipping");
        return [];
      }

      const lastSync = state.getLastSync("chrome");
      const items: Item[] = [];
      const seenUrls = new Set<string>();

      // Process each profile
      for (let pi = 0; pi < historyPaths.length; pi++) {
        const profilePath = historyPaths[pi]!;

        // --- History ---
        const historyTemp = copyToTemp(profilePath, `History-${pi}`);
        if (historyTemp) {
          try {
            const db = new Database(historyTemp, { readonly: true });
            const lastSyncChrome =
              lastSync > 0
                ? (BigInt(lastSync) + CHROME_EPOCH_OFFSET) * 1000000n
                : 0n;

            const rows = db
              .query(
                `
                SELECT
                  u.id,
                  u.url,
                  u.title,
                  v.visit_time,
                  v.visit_duration,
                  u.visit_count
                FROM urls u
                JOIN visits v ON u.id = v.url
                WHERE v.visit_time > ?
                ORDER BY v.visit_time DESC
                LIMIT 5000
                `
              )
              .all(lastSyncChrome.toString()) as any[];

            db.close();

            for (const row of rows) {
              if (seenUrls.has(row.url)) continue;
              seenUrls.add(row.url);

              items.push({
                source: "chrome",
                externalId: `chrome-history-${row.id}-${row.visit_time}`,
                content: `${row.title || "Untitled"}\n${row.url}`,
                metadata: {
                  type: "history",
                  url: row.url,
                  title: row.title,
                  visitCount: row.visit_count,
                  visitDuration: row.visit_duration,
                  category: categorizeDomain(row.url),
                },
                createdAt: chromeTimeToUnix(row.visit_time),
              });
            }

            // --- Search Terms ---
            try {
              const searchDb = new Database(historyTemp, { readonly: true });
              const searchRows = searchDb
                .query(
                  `
                  SELECT DISTINCT
                    kst.term,
                    kst.url_id,
                    u.url,
                    u.last_visit_time
                  FROM keyword_search_terms kst
                  JOIN urls u ON kst.url_id = u.id
                  WHERE u.last_visit_time > ?
                  ORDER BY u.last_visit_time DESC
                  LIMIT 100
                  `
                )
                .all(lastSyncChrome.toString()) as any[];

              searchDb.close();

              const seenTerms = new Set<string>();
              for (const row of searchRows) {
                const term = (row.term || "").trim().toLowerCase();
                if (!term || seenTerms.has(term)) continue;
                seenTerms.add(term);

                items.push({
                  source: "chrome",
                  externalId: `chrome-search-${term.replace(/\s+/g, "-").slice(0, 50)}`,
                  content: `Search: ${row.term}`,
                  metadata: {
                    type: "search",
                    term: row.term,
                    url: row.url,
                  },
                  createdAt: chromeTimeToUnix(row.last_visit_time),
                });
              }
            } catch {
              // keyword_search_terms may not exist in all profiles
            }
          } catch (e) {
            console.warn(`[chrome] Failed to read history: ${e}`);
          }
        }
      }

      // --- Bookmarks (from first profile with Bookmarks file) ---
      for (const profilePath of historyPaths) {
        const profileDir = join(profilePath, "..");
        const bookmarksPath = join(profileDir, "Bookmarks");
        if (existsSync(bookmarksPath)) {
          try {
            const raw = readFileSync(bookmarksPath, "utf-8");
            const data = JSON.parse(raw);

            function extractBookmarks(node: any, folder: string) {
              if (!node) return;
              if (node.type === "url") {
                const addedAt = node.date_added
                  ? chromeTimeToUnix(Number(node.date_added))
                  : 0;
                if (addedAt > lastSync) {
                  items.push({
                    source: "chrome",
                    externalId: `chrome-bookmark-${node.id}`,
                    content: `${node.name}\n${node.url}`,
                    metadata: {
                      type: "bookmark",
                      url: node.url,
                      name: node.name,
                      folder,
                    },
                    createdAt: addedAt,
                  });
                }
              }
              if (node.children) {
                const folderName = node.name || folder;
                for (const child of node.children) {
                  extractBookmarks(child, folderName);
                }
              }
            }

            if (data.roots) {
              for (const [key, root] of Object.entries(data.roots)) {
                if (root && typeof root === "object") {
                  extractBookmarks(root, key);
                }
              }
            }
          } catch (e) {
            console.warn(`[chrome] Failed to read bookmarks: ${e}`);
          }
          break; // Only process bookmarks from first profile
        }
      }

      // --- Downloads (from first profile) ---
      if (historyPaths.length > 0) {
        const downloadsTemp = copyToTemp(historyPaths[0]!, "History-downloads");
        if (downloadsTemp) {
          try {
            const db = new Database(downloadsTemp, { readonly: true });
            const lastSyncChrome =
              lastSync > 0
                ? (BigInt(lastSync) + CHROME_EPOCH_OFFSET) * 1000000n
                : 0n;

            const rows = db
              .query(
                `
                SELECT
                  id,
                  target_path,
                  tab_url,
                  total_bytes,
                  start_time,
                  mime_type
                FROM downloads
                WHERE start_time > ?
                ORDER BY start_time DESC
                LIMIT 200
                `
              )
              .all(lastSyncChrome.toString()) as any[];

            db.close();

            for (const row of rows) {
              items.push({
                source: "chrome",
                externalId: `chrome-download-${row.id}`,
                content: `Downloaded: ${row.target_path}\nFrom: ${row.tab_url || "unknown"}`,
                metadata: {
                  type: "download",
                  targetPath: row.target_path,
                  tabUrl: row.tab_url,
                  totalBytes: row.total_bytes,
                  mimeType: row.mime_type,
                },
                createdAt: chromeTimeToUnix(row.start_time),
              });
            }
          } catch (e) {
            console.warn(`[chrome] Failed to read downloads: ${e}`);
          }
        }
      }

      return items;
    } catch (e) {
      console.warn(`[chrome] Failed to fetch data: ${e}`);
      return [];
    }
  },
};
