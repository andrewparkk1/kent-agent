import { test, expect, describe, beforeEach } from "bun:test";
import { mkdtempSync, writeFileSync, mkdirSync, utimesSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { MockSyncState, validateItem, LIVE } from "./_helpers.ts";
import { createRecentFilesSource, recentFiles } from "@daemon/sources/recent-files.ts";

const FIXED_NOW_SEC = 1_700_000_000; // 2023-11-14

function setMtimeSec(path: string, sec: number) {
  const d = new Date(sec * 1000);
  utimesSync(path, d, d);
}

function makeFixture(): string {
  const root = mkdtempSync(join(tmpdir(), "recent-files-"));

  // file within window (1 day old)
  writeFileSync(join(root, "fresh.pdf"), "pdf content");
  setMtimeSec(join(root, "fresh.pdf"), FIXED_NOW_SEC - 86400);

  // file outside window (30 days old)
  writeFileSync(join(root, "old.pdf"), "old pdf");
  setMtimeSec(join(root, "old.pdf"), FIXED_NOW_SEC - 30 * 86400);

  // Nested recent file
  mkdirSync(join(root, "sub"), { recursive: true });
  writeFileSync(join(root, "sub", "code.ts"), "console.log('hi')");
  setMtimeSec(join(root, "sub", "code.ts"), FIXED_NOW_SEC - 3600);

  // Hidden file (should be skipped)
  writeFileSync(join(root, ".secret"), "shh");
  setMtimeSec(join(root, ".secret"), FIXED_NOW_SEC - 3600);

  // node_modules noise (should be skipped via walk filter)
  mkdirSync(join(root, "node_modules"), { recursive: true });
  writeFileSync(join(root, "node_modules", "pkg.js"), "noise");
  setMtimeSec(join(root, "node_modules", "pkg.js"), FIXED_NOW_SEC - 3600);

  return root;
}

describe("recent-files source (fixture)", () => {
  let root: string;
  beforeEach(() => {
    root = makeFixture();
  });

  test("existing export still works", () => {
    expect(recentFiles.name).toBe("recent-files");
    expect(typeof recentFiles.fetchNew).toBe("function");
  });

  test("returns only files modified within defaultDays window", async () => {
    const src = createRecentFilesSource({
      roots: [root],
      useMdfind: false,
      now: () => FIXED_NOW_SEC,
    });
    const items = await src.fetchNew(new MockSyncState(), { defaultDays: 7 });

    // Only fresh.pdf (1 day) and sub/code.ts (1 hour) — NOT old.pdf or hidden/noise
    expect(items.length).toBe(2);
    for (const item of items) {
      validateItem(item, "recent-files", /^recent-files-[0-9a-f]{8}$/);
      expect(item.metadata.path).toBeString();
      expect(item.metadata.filename).toBeString();
      expect(item.metadata.sizeBytes).toBeGreaterThan(0);
      expect(typeof item.metadata.category).toBe("string");
    }

    const names = items.map((i) => i.metadata.filename).sort();
    expect(names).toEqual(["code.ts", "fresh.pdf"]);

    const pdfItem = items.find((i) => i.metadata.filename === "fresh.pdf")!;
    expect(pdfItem.metadata.category).toBe("document");
    expect(pdfItem.metadata.extension).toBe(".pdf");
    expect(pdfItem.content).toContain("fresh.pdf");
    expect(pdfItem.content).toContain("document");
  });

  test("hidden files and noise dirs are skipped", async () => {
    const src = createRecentFilesSource({
      roots: [root],
      useMdfind: false,
      now: () => FIXED_NOW_SEC,
    });
    const items = await src.fetchNew(new MockSyncState(), { defaultDays: 7 });
    for (const it of items) {
      expect(it.metadata.filename).not.toBe(".secret");
      expect(it.metadata.filename).not.toBe("pkg.js");
      expect(it.metadata.path).not.toContain("node_modules");
    }
  });

  test("sync cutoff: re-sync returns only newer files", async () => {
    const src = createRecentFilesSource({
      roots: [root],
      useMdfind: false,
      now: () => FIXED_NOW_SEC,
    });
    const state = new MockSyncState();
    const first = await src.fetchNew(state, { defaultDays: 7 });
    expect(first.length).toBe(2);

    state.markSynced("recent-files", FIXED_NOW_SEC);

    const second = await src.fetchNew(state, { defaultDays: 7 });
    expect(second.length).toBe(0);

    // Touch code.ts to a fresh mtime > lastSync
    setMtimeSec(join(root, "sub", "code.ts"), FIXED_NOW_SEC + 100);
    const third = await src.fetchNew(state, { defaultDays: 7 });
    expect(third.length).toBe(1);
    expect(third[0]!.metadata.filename).toBe("code.ts");
  });

  test.skipIf(!LIVE)("LIVE: walks real recent file paths", async () => {
    const items = await recentFiles.fetchNew(new MockSyncState(), { defaultDays: 7, limit: 10 });
    for (const item of items) validateItem(item, "recent-files", /^recent-files-/);
  }, 120_000);
});
