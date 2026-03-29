import { Database } from "bun:sqlite";
import { join } from "path";
import { homedir } from "os";
import { copyFileSync, existsSync, readFileSync, mkdirSync } from "fs";
import { tmpdir } from "os";
import type { Source, SyncState, Item } from "./types";

const CHROME_DIR = join(
  homedir(),
  "Library/Application Support/Google/Chrome/Default"
);
const TEMP_DIR = join(tmpdir(), "kent-chrome");

// Chrome epoch: microseconds since Jan 1, 1601
// Unix epoch: seconds since Jan 1, 1970
// Difference: 11644473600 seconds
const CHROME_EPOCH_OFFSET = 11644473600n;

function chromeTimeToUnix(chromeTime: number | bigint): number {
  const microseconds = BigInt(chromeTime);
  const seconds = microseconds / 1000000n;
  return Number(seconds - CHROME_EPOCH_OFFSET);
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

export const chrome: Source = {
  name: "chrome",

  async fetchNew(state: SyncState): Promise<Item[]> {
    try {
      if (!existsSync(CHROME_DIR)) {
        console.warn("[chrome] Chrome profile directory not found, skipping");
        return [];
      }

      const lastSync = state.getLastSync("chrome");
      const items: Item[] = [];

      // --- History ---
      const historyTemp = copyToTemp(
        join(CHROME_DIR, "History"),
        "History"
      );
      if (historyTemp) {
        try {
          const db = new Database(historyTemp, { readonly: true });
          // Convert lastSync to Chrome time for comparison
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
              LIMIT 500
              `
            )
            .all(lastSyncChrome.toString()) as Array<{
            id: number;
            url: string;
            title: string;
            visit_time: number;
            visit_duration: number;
            visit_count: number;
          }>;

          db.close();

          for (const row of rows) {
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
              },
              createdAt: chromeTimeToUnix(row.visit_time),
            });
          }
        } catch (e) {
          console.warn(`[chrome] Failed to read history: ${e}`);
        }
      }

      // --- Bookmarks ---
      const bookmarksPath = join(CHROME_DIR, "Bookmarks");
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
      }

      // --- Downloads ---
      const downloadsTemp = copyToTemp(
        join(CHROME_DIR, "History"),
        "History-downloads"
      );
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
            .all(lastSyncChrome.toString()) as Array<{
            id: number;
            target_path: string;
            tab_url: string;
            total_bytes: number;
            start_time: number;
            mime_type: string;
          }>;

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

      // --- Top Sites ---
      const topSitesTemp = copyToTemp(
        join(CHROME_DIR, "Top Sites"),
        "TopSites"
      );
      if (topSitesTemp) {
        try {
          const db = new Database(topSitesTemp, { readonly: true });

          const rows = db
            .query(
              `
              SELECT url, url_rank, title
              FROM top_sites
              ORDER BY url_rank ASC
              LIMIT 50
              `
            )
            .all() as Array<{
            url: string;
            url_rank: number;
            title: string;
          }>;

          db.close();

          for (const row of rows) {
            items.push({
              source: "chrome",
              externalId: `chrome-topsite-${row.url}`,
              content: `${row.title || "Untitled"}\n${row.url}`,
              metadata: {
                type: "top-site",
                url: row.url,
                rank: row.url_rank,
                title: row.title,
              },
              createdAt: Math.floor(Date.now() / 1000),
            });
          }
        } catch (e) {
          console.warn(`[chrome] Failed to read top sites: ${e}`);
        }
      }

      return items;
    } catch (e) {
      console.warn(`[chrome] Failed to fetch data: ${e}`);
      return [];
    }
  },
};
