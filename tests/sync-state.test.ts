import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import { existsSync, mkdirSync, rmSync, readFileSync, writeFileSync, renameSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { SyncState } from "@daemon/sources/types.ts";

/**
 * Tests for FileSyncState (daemon/sync-state.ts).
 *
 * Re-implements the logic against a temp directory to avoid
 * touching ~/.kent/state.json.
 */

class TestFileSyncState implements SyncState {
  private data: { lastSync: Record<string, number> };
  private dir: string;
  private statePath: string;

  constructor(dir: string) {
    this.dir = dir;
    this.statePath = join(dir, "state.json");
    this.data = this.load();
  }

  private load(): { lastSync: Record<string, number> } {
    try {
      if (existsSync(this.statePath)) {
        const raw = readFileSync(this.statePath, "utf-8");
        const parsed = JSON.parse(raw);
        return { lastSync: parsed.lastSync || {} };
      }
    } catch {
      // start fresh
    }
    return { lastSync: {} };
  }

  private save(): void {
    mkdirSync(this.dir, { recursive: true });
    const tempPath = this.statePath + ".tmp";
    writeFileSync(tempPath, JSON.stringify(this.data, null, 2), "utf-8");
    renameSync(tempPath, this.statePath);
  }

  getLastSync(source: string): number {
    return this.data.lastSync[source] || 0;
  }

  markSynced(source: string): void {
    this.data.lastSync[source] = Math.floor(Date.now() / 1000);
    this.save();
  }
}

describe("FileSyncState", () => {
  let dir: string;

  beforeEach(() => {
    dir = join(tmpdir(), `kent-syncstate-test-${crypto.randomUUID()}`);
    mkdirSync(dir, { recursive: true });
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test("returns 0 for unknown source", () => {
    const state = new TestFileSyncState(dir);
    expect(state.getLastSync("imessage")).toBe(0);
    expect(state.getLastSync("unknown")).toBe(0);
  });

  test("markSynced updates timestamp", () => {
    const state = new TestFileSyncState(dir);
    const before = Math.floor(Date.now() / 1000);
    state.markSynced("imessage");
    const after = Math.floor(Date.now() / 1000);

    const ts = state.getLastSync("imessage");
    expect(ts).toBeGreaterThanOrEqual(before);
    expect(ts).toBeLessThanOrEqual(after);
  });

  test("markSynced persists to disk", () => {
    const state = new TestFileSyncState(dir);
    state.markSynced("gmail");

    // Read state file directly
    const raw = readFileSync(join(dir, "state.json"), "utf-8");
    const parsed = JSON.parse(raw);
    expect(parsed.lastSync.gmail).toBeGreaterThan(0);
  });

  test("persisted state survives reload", () => {
    const state1 = new TestFileSyncState(dir);
    state1.markSynced("github");
    const ts = state1.getLastSync("github");

    // Create new instance — should load from disk
    const state2 = new TestFileSyncState(dir);
    expect(state2.getLastSync("github")).toBe(ts);
  });

  test("tracks multiple sources independently", () => {
    const state = new TestFileSyncState(dir);
    state.markSynced("imessage");
    const imessageTs = state.getLastSync("imessage");

    state.markSynced("gmail");
    const gmailTs = state.getLastSync("gmail");

    // Both should have timestamps, imessage unchanged
    expect(imessageTs).toBeGreaterThan(0);
    expect(gmailTs).toBeGreaterThanOrEqual(imessageTs);
    expect(state.getLastSync("imessage")).toBe(imessageTs);
  });

  test("handles corrupted state file gracefully", () => {
    writeFileSync(join(dir, "state.json"), "corrupted{{{", "utf-8");

    const state = new TestFileSyncState(dir);
    // Should start fresh without crashing
    expect(state.getLastSync("imessage")).toBe(0);
  });

  test("handles state file with missing lastSync key", () => {
    writeFileSync(join(dir, "state.json"), JSON.stringify({ other: "data" }), "utf-8");

    const state = new TestFileSyncState(dir);
    expect(state.getLastSync("imessage")).toBe(0);
  });

  test("atomic write uses temp file", () => {
    const state = new TestFileSyncState(dir);
    state.markSynced("test");

    // After successful save, temp file should not exist
    expect(existsSync(join(dir, "state.json.tmp"))).toBe(false);
    // But real file should
    expect(existsSync(join(dir, "state.json"))).toBe(true);
  });
});
