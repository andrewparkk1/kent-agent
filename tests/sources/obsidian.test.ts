import { test, expect, describe, beforeEach } from "bun:test";
import { mkdtempSync, writeFileSync, mkdirSync, utimesSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { MockSyncState, validateItem, LIVE } from "./_helpers.ts";
import { createObsidianSource, obsidian } from "@daemon/sources/obsidian.ts";

function makeVault(): string {
  const dir = mkdtempSync(join(tmpdir(), "obs-vault-"));
  // Note with frontmatter + tags
  writeFileSync(
    join(dir, "with-frontmatter.md"),
    "---\ntitle: Frontmatter Note\ntags: [alpha, beta]\npublished: true\n---\n\nBody with [[internal link]] here.\n"
  );
  // Plain note
  writeFileSync(join(dir, "plain.md"), "# plain\n\nJust a plain note.");
  // Nested note in subfolder
  mkdirSync(join(dir, "subfolder"), { recursive: true });
  writeFileSync(join(dir, "subfolder", "nested.md"), "Nested content.");
  // Non-markdown file that should be skipped
  writeFileSync(join(dir, "notes.txt"), "should be skipped");
  // Hidden .obsidian dir
  mkdirSync(join(dir, ".obsidian"), { recursive: true });
  writeFileSync(join(dir, ".obsidian", "config.md"), "ignored");
  return dir;
}

describe("obsidian source (fixture)", () => {
  let vault: string;
  beforeEach(() => {
    vault = makeVault();
  });

  test("existing export still works", () => {
    expect(obsidian.name).toBe("obsidian");
    expect(typeof obsidian.fetchNew).toBe("function");
  });

  test("walks vault and returns 3 .md items (non-.md skipped)", async () => {
    const src = createObsidianSource({ vaultPath: vault, now: () => 2_000_000_000 });
    const items = await src.fetchNew(new MockSyncState(), { defaultDays: 0 });
    expect(items.length).toBe(3);

    for (const item of items) items && validateItem(item, "obsidian", /^obsidian-[0-9a-f]+$/);

    // externalId is derived from relative path; verify all 3 relpaths
    const ids = items.map((i) => i.externalId).sort();
    expect(ids.length).toBe(3);
    for (const id of ids) expect(id).toMatch(/^obsidian-[0-9a-f]+$/);

    const fm = items.find((i) => i.content.includes("[[internal link]]"))!;
    expect(fm).toBeDefined();
    expect(fm.metadata.tags).toEqual(["alpha", "beta"]);
    expect(fm.metadata.published).toBe(true);
    expect(fm.metadata.folder).toBe("");
    expect(fm.content).toContain("[[internal link]]");

    const nested = items.find((i) => i.content.includes("Nested content."))!;
    expect(nested).toBeDefined();
    expect(nested.metadata.folder).toBe("subfolder");

    // createdAt is a positive integer (seconds)
    for (const it of items) {
      expect(Number.isFinite(it.createdAt)).toBe(true);
      expect(it.createdAt).toBeGreaterThan(0);
    }
  });

  test("sync cutoff: unchanged files are not re-emitted; modified files are", async () => {
    const src = createObsidianSource({ vaultPath: vault, now: () => 2_000_000_000 });
    const state = new MockSyncState();

    const first = await src.fetchNew(state, { defaultDays: 0 });
    expect(first.length).toBe(3);

    // Mark synced slightly in the future to ensure cutoff excludes all current files
    const nowSec = Math.floor(Date.now() / 1000) + 10;
    state.markSynced("obsidian", nowSec);

    const second = await src.fetchNew(state, { defaultDays: 0 });
    expect(second.length).toBe(0);

    // Modify one file — bump mtime forward
    const bumpedPath = join(vault, "plain.md");
    writeFileSync(bumpedPath, "# plain\n\nEdited content.");
    const future = new Date((nowSec + 100) * 1000);
    utimesSync(bumpedPath, future, future);

    const third = await src.fetchNew(state, { defaultDays: 0 });
    expect(third.length).toBe(1);
    expect(third[0]!.content).toContain("Edited content.");
  });

  test("non-.md files in vault are skipped", async () => {
    const src = createObsidianSource({ vaultPath: vault });
    const items = await src.fetchNew(new MockSyncState(), { defaultDays: 0 });
    // Only 3 .md files should be returned, notes.txt excluded
    expect(items.length).toBe(3);
    for (const it of items) {
      expect(it.content).not.toContain("should be skipped");
    }
  });

  test.skipIf(!LIVE)("LIVE: reads from real Obsidian vault", async () => {
    const items = await obsidian.fetchNew(new MockSyncState(), { defaultDays: 30, limit: 10 });
    for (const item of items) validateItem(item, "obsidian", /^obsidian-/);
  }, 60_000);
});
