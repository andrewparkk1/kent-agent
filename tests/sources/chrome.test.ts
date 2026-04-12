import { test, expect, describe, beforeAll, afterAll } from "bun:test";
import { Database } from "bun:sqlite";
import { tmpdir } from "os";
import { join } from "path";
import { mkdtempSync, writeFileSync, rmSync } from "fs";
import { MockSyncState, validateItem, LIVE } from "./_helpers.ts";

// Chrome epoch: microseconds since 1601-01-01. Offset to unix = 11644473600 seconds.
const CHROME_EPOCH_OFFSET = 11644473600n;
function unixToChrome(unixSeconds: number): bigint {
  return (BigInt(unixSeconds) + CHROME_EPOCH_OFFSET) * 1000000n;
}

function buildChromeHistoryDb(path: string) {
  const db = new Database(path, { create: true });
  db.exec(`
    CREATE TABLE urls (
      id INTEGER PRIMARY KEY,
      url LONGVARCHAR,
      title LONGVARCHAR,
      visit_count INTEGER DEFAULT 0,
      typed_count INTEGER DEFAULT 0,
      last_visit_time INTEGER,
      hidden INTEGER DEFAULT 0
    );
    CREATE TABLE visits (
      id INTEGER PRIMARY KEY,
      url INTEGER,
      visit_time INTEGER,
      from_visit INTEGER,
      transition INTEGER,
      segment_id INTEGER,
      visit_duration INTEGER DEFAULT 0
    );
    CREATE TABLE keyword_search_terms (
      keyword_id INTEGER,
      url_id INTEGER,
      term LONGVARCHAR
    );
    CREATE TABLE downloads (
      id INTEGER PRIMARY KEY,
      target_path LONGVARCHAR,
      tab_url LONGVARCHAR,
      total_bytes INTEGER,
      start_time INTEGER,
      mime_type VARCHAR
    );
  `);
  db.close();
}

describe("chrome source", () => {
  let tmpDir: string;
  let historyDbPath: string;
  let bookmarksJsonPath: string;

  // Fixed points in time for deterministic assertions.
  // 2024-06-01 12:00:00 UTC = 1717243200
  const T_BASE = 1717243200;
  const T_PAGE = T_BASE + 100;
  const T_SEARCH = T_BASE + 200;
  const T_DOWNLOAD = T_BASE + 300;
  const T_BOOKMARK = T_BASE + 400;

  beforeAll(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "kent-chrome-test-"));
    historyDbPath = join(tmpDir, "History");
    bookmarksJsonPath = join(tmpDir, "Bookmarks");

    buildChromeHistoryDb(historyDbPath);

    const db = new Database(historyDbPath);
    db.run(
      "INSERT INTO urls (id, url, title, visit_count, last_visit_time) VALUES (?, ?, ?, ?, ?)",
      [1, "https://github.com/anthropics/anthropic-sdk", "Anthropic SDK", 5, unixToChrome(T_PAGE).toString()]
    );
    db.run(
      "INSERT INTO visits (id, url, visit_time, visit_duration) VALUES (?, ?, ?, ?)",
      [10, 1, unixToChrome(T_PAGE).toString(), 4242]
    );
    db.run(
      "INSERT INTO urls (id, url, title, visit_count, last_visit_time) VALUES (?, ?, ?, ?, ?)",
      [2, "https://www.google.com/search?q=bun+sqlite", "bun sqlite - Google Search", 1, unixToChrome(T_SEARCH).toString()]
    );
    db.run(
      "INSERT INTO visits (id, url, visit_time, visit_duration) VALUES (?, ?, ?, ?)",
      [11, 2, unixToChrome(T_SEARCH).toString(), 0]
    );
    db.run(
      "INSERT INTO keyword_search_terms (keyword_id, url_id, term) VALUES (?, ?, ?)",
      [1, 2, "Bun SQLite"]
    );
    db.run(
      "INSERT INTO downloads (id, target_path, tab_url, total_bytes, start_time, mime_type) VALUES (?, ?, ?, ?, ?, ?)",
      [77, "/Users/test/Downloads/report.pdf", "https://example.com/report", 12345, unixToChrome(T_DOWNLOAD).toString(), "application/pdf"]
    );
    db.close();

    const bookmarks = {
      roots: {
        bookmark_bar: {
          name: "Bookmarks bar",
          type: "folder",
          children: [
            {
              id: "500",
              type: "url",
              name: "Example Bookmark",
              url: "https://example.org/bookmarked",
              date_added: unixToChrome(T_BOOKMARK).toString(),
            },
          ],
        },
      },
    };
    writeFileSync(bookmarksJsonPath, JSON.stringify(bookmarks));
  });

  afterAll(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("conforms to Source interface", async () => {
    const { chrome } = await import("@daemon/sources/chrome.ts");
    expect(chrome.name).toBe("chrome");
    expect(typeof chrome.fetchNew).toBe("function");
  });

  test("factory produces a Source", async () => {
    const { createChromeSource } = await import("@daemon/sources/chrome.ts");
    const src = createChromeSource({ historyDbPath, bookmarksJsonPath });
    expect(src.name).toBe("chrome");
    expect(typeof src.fetchNew).toBe("function");
  });

  test("fetchNew returns history, search, bookmark, and download items from fixture", async () => {
    const { createChromeSource } = await import("@daemon/sources/chrome.ts");
    const src = createChromeSource({ historyDbPath, bookmarksJsonPath });
    const state = new MockSyncState();

    const items = await src.fetchNew(state);

    expect(items).toBeArray();
    for (const item of items) validateItem(item, "chrome", /^chrome-/);

    const byType: Record<string, any[]> = {};
    for (const it of items) {
      const t = it.metadata.type as string;
      (byType[t] ??= []).push(it);
    }

    expect(byType.history).toBeDefined();
    expect(byType.history.length).toBe(2);

    const githubItem = byType.history.find(
      (i) => i.metadata.url === "https://github.com/anthropics/anthropic-sdk"
    );
    expect(githubItem).toBeDefined();
    expect(githubItem.externalId).toBe(`chrome-history-1-${unixToChrome(T_PAGE).toString()}`);
    expect(githubItem.content).toBe("Anthropic SDK\nhttps://github.com/anthropics/anthropic-sdk");
    expect(githubItem.metadata.title).toBe("Anthropic SDK");
    expect(githubItem.metadata.visitCount).toBe(5);
    expect(githubItem.metadata.visitDuration).toBe(4242);
    expect(githubItem.metadata.category).toBe("work");
    expect(githubItem.createdAt).toBe(T_PAGE);

    expect(byType.search).toBeDefined();
    expect(byType.search.length).toBe(1);
    const searchItem = byType.search[0];
    expect(searchItem.externalId).toBe("chrome-search-bun-sqlite");
    expect(searchItem.content).toBe("Search: Bun SQLite");
    expect(searchItem.metadata.term).toBe("Bun SQLite");
    expect(searchItem.metadata.url).toBe("https://www.google.com/search?q=bun+sqlite");
    expect(searchItem.createdAt).toBe(T_SEARCH);

    expect(byType.bookmark).toBeDefined();
    expect(byType.bookmark.length).toBe(1);
    const bm = byType.bookmark[0];
    expect(bm.externalId).toBe("chrome-bookmark-500");
    expect(bm.content).toBe("Example Bookmark\nhttps://example.org/bookmarked");
    expect(bm.metadata.url).toBe("https://example.org/bookmarked");
    expect(bm.metadata.name).toBe("Example Bookmark");
    expect(bm.metadata.folder).toBe("Bookmarks bar");
    expect(bm.createdAt).toBe(T_BOOKMARK);

    expect(byType.download).toBeDefined();
    expect(byType.download.length).toBe(1);
    const dl = byType.download[0];
    expect(dl.externalId).toBe("chrome-download-77");
    expect(dl.content).toBe("Downloaded: /Users/test/Downloads/report.pdf\nFrom: https://example.com/report");
    expect(dl.metadata.targetPath).toBe("/Users/test/Downloads/report.pdf");
    expect(dl.metadata.tabUrl).toBe("https://example.com/report");
    expect(dl.metadata.totalBytes).toBe(12345);
    expect(dl.metadata.mimeType).toBe("application/pdf");
    expect(dl.createdAt).toBe(T_DOWNLOAD);
  });

  test("Chrome microsecond-since-1601 timestamps convert correctly", async () => {
    const { createChromeSource } = await import("@daemon/sources/chrome.ts");
    const src = createChromeSource({ historyDbPath, bookmarksJsonPath });
    const items = await src.fetchNew(new MockSyncState());
    const gh = items.find(
      (i) => i.metadata.type === "history" && i.metadata.url === "https://github.com/anthropics/anthropic-sdk"
    )!;
    expect(gh.createdAt).toBe(T_PAGE);
  });

  test("sync cutoff: markSynced filters out older visits", async () => {
    const { createChromeSource } = await import("@daemon/sources/chrome.ts");
    const src = createChromeSource({ historyDbPath, bookmarksJsonPath });
    const state = new MockSyncState();

    state.markSynced("chrome", T_PAGE + 1);

    const items = await src.fetchNew(state);

    const history = items.filter((i) => i.metadata.type === "history");
    expect(history.length).toBe(1);
    expect(history[0]!.metadata.url).toBe("https://www.google.com/search?q=bun+sqlite");

    const search = items.filter((i) => i.metadata.type === "search");
    expect(search.length).toBe(1);

    const bm = items.filter((i) => i.metadata.type === "bookmark");
    expect(bm.length).toBe(1);

    state.markSynced("chrome", T_BOOKMARK + 1);
    const items2 = await src.fetchNew(state);
    expect(items2.length).toBe(0);
  });

  test.skipIf(!LIVE)("LIVE: reads from Chrome History sqlite", async () => {
    const { chrome } = await import("@daemon/sources/chrome.ts");
    const items = await chrome.fetchNew(new MockSyncState(), { defaultDays: 7, limit: 10 });
    for (const item of items) validateItem(item, "chrome", /^chrome-/);
  }, 60_000);
});
