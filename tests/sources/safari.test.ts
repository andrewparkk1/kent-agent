import { test, expect, describe, beforeAll, afterAll } from "bun:test";
import { Database } from "bun:sqlite";
import { tmpdir } from "os";
import { join } from "path";
import { mkdtempSync, rmSync } from "fs";
import { MockSyncState, validateItem, LIVE } from "./_helpers.ts";

// Safari stores timestamps as CFAbsoluteTime: seconds since 2001-01-01 UTC.
// Offset to unix = 978307200 seconds.
const CORE_DATA_EPOCH_OFFSET = 978307200;
function unixToCoreData(unixSeconds: number): number {
  return unixSeconds - CORE_DATA_EPOCH_OFFSET;
}

const SAFARI_SCHEMA_SQL = `
  CREATE TABLE history_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    url TEXT NOT NULL UNIQUE,
    domain_expansion TEXT,
    visit_count INTEGER NOT NULL,
    daily_visit_counts BLOB,
    weekly_visit_counts BLOB,
    autocomplete_triggers BLOB,
    should_recompute_derived_visit_counts INTEGER,
    visit_count_score INTEGER
  );
  CREATE TABLE history_visits (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    history_item INTEGER NOT NULL REFERENCES history_items(id) ON DELETE CASCADE,
    visit_time REAL NOT NULL,
    title TEXT,
    load_successful BOOLEAN NOT NULL DEFAULT 1,
    http_non_get BOOLEAN NOT NULL DEFAULT 0,
    synthesized BOOLEAN NOT NULL DEFAULT 0,
    redirect_source INTEGER,
    redirect_destination INTEGER,
    origin INTEGER NOT NULL DEFAULT 0,
    generation INTEGER NOT NULL DEFAULT 0,
    attributes INTEGER NOT NULL DEFAULT 0,
    score INTEGER NOT NULL DEFAULT 0
  );
`;

function buildSafariHistoryDb(path: string) {
  const db = new Database(path, { create: true });
  db.run(SAFARI_SCHEMA_SQL);
  db.close();
}

describe("safari source", () => {
  let tmpDir: string;
  let historyDbPath: string;

  const T_BASE = 1717243200;
  const T_VISIT_A = T_BASE + 100;
  const T_VISIT_B = T_BASE + 200;

  beforeAll(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "kent-safari-test-"));
    historyDbPath = join(tmpDir, "History.db");

    buildSafariHistoryDb(historyDbPath);

    const db = new Database(historyDbPath);
    db.run(
      "INSERT INTO history_items (id, url, domain_expansion, visit_count) VALUES (?, ?, ?, ?)",
      [1, "https://github.com/oven-sh/bun", "github", 7]
    );
    db.run(
      "INSERT INTO history_visits (id, history_item, visit_time, title) VALUES (?, ?, ?, ?)",
      [100, 1, unixToCoreData(T_VISIT_A), "GitHub - oven-sh/bun"]
    );
    db.run(
      "INSERT INTO history_items (id, url, domain_expansion, visit_count) VALUES (?, ?, ?, ?)",
      [2, "https://example.org/page", "example", 1]
    );
    db.run(
      "INSERT INTO history_visits (id, history_item, visit_time, title) VALUES (?, ?, ?, ?)",
      [101, 2, unixToCoreData(T_VISIT_B), "Example Page"]
    );
    db.close();
  });

  afterAll(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("conforms to Source interface", async () => {
    const { safari } = await import("@daemon/sources/safari.ts");
    expect(safari.name).toBe("safari");
    expect(typeof safari.fetchNew).toBe("function");
  });

  test("factory produces a Source", async () => {
    const { createSafariSource } = await import("@daemon/sources/safari.ts");
    const src = createSafariSource({ historyDbPath });
    expect(src.name).toBe("safari");
    expect(typeof src.fetchNew).toBe("function");
  });

  test("fetchNew returns history items from fixture", async () => {
    const { createSafariSource } = await import("@daemon/sources/safari.ts");
    const src = createSafariSource({ historyDbPath });

    const items = await src.fetchNew(new MockSyncState());

    expect(items).toBeArray();
    expect(items.length).toBe(2);
    for (const item of items) validateItem(item, "safari", /^safari-history-/);

    // Ordered DESC by visit_time => B first
    const [first, second] = items;

    expect(first!.metadata.url).toBe("https://example.org/page");
    expect(first!.externalId).toBe(`safari-history-2-${unixToCoreData(T_VISIT_B)}`);
    expect(first!.content).toBe("Example Page\nhttps://example.org/page");
    expect(first!.metadata.type).toBe("history");
    expect(first!.metadata.title).toBe("Example Page");
    expect(first!.metadata.visitCount).toBe(1);
    expect(first!.metadata.domain).toBe("example");
    expect(first!.metadata.category).toBe("other");
    expect(first!.createdAt).toBe(T_VISIT_B);

    expect(second!.metadata.url).toBe("https://github.com/oven-sh/bun");
    expect(second!.externalId).toBe(`safari-history-1-${unixToCoreData(T_VISIT_A)}`);
    expect(second!.content).toBe("GitHub - oven-sh/bun\nhttps://github.com/oven-sh/bun");
    expect(second!.metadata.visitCount).toBe(7);
    expect(second!.metadata.domain).toBe("github");
    expect(second!.metadata.category).toBe("work");
    expect(second!.createdAt).toBe(T_VISIT_A);
  });

  test("CFAbsoluteTime conversion from epoch 2001-01-01", async () => {
    const { createSafariSource } = await import("@daemon/sources/safari.ts");
    const src = createSafariSource({ historyDbPath });
    const items = await src.fetchNew(new MockSyncState());
    const ts = items.map((i) => i.createdAt).sort((a, b) => a - b);
    expect(ts).toEqual([T_VISIT_A, T_VISIT_B]);
  });

  test("sync cutoff: markSynced filters out older visits", async () => {
    const { createSafariSource } = await import("@daemon/sources/safari.ts");
    const src = createSafariSource({ historyDbPath });
    const state = new MockSyncState();

    state.markSynced("safari", T_VISIT_A + 1);
    const items = await src.fetchNew(state);
    expect(items.length).toBe(1);
    expect(items[0]!.metadata.url).toBe("https://example.org/page");
    expect(items[0]!.createdAt).toBe(T_VISIT_B);

    state.markSynced("safari", T_VISIT_B + 1);
    const items2 = await src.fetchNew(state);
    expect(items2.length).toBe(0);
  });

  test("limit option caps the number of results", async () => {
    const { createSafariSource } = await import("@daemon/sources/safari.ts");
    const src = createSafariSource({ historyDbPath });
    const items = await src.fetchNew(new MockSyncState(), { limit: 1 });
    expect(items.length).toBe(1);
  });

  test.skipIf(!LIVE)("LIVE: reads from Safari History.db", async () => {
    const { safari } = await import("@daemon/sources/safari.ts");
    const items = await safari.fetchNew(new MockSyncState(), { defaultDays: 7, limit: 10 });
    for (const item of items) validateItem(item, "safari", /^safari-/);
  }, 60_000);
});
