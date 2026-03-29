import { test, expect, beforeEach, afterEach, describe } from "bun:test";
import { existsSync, mkdirSync, rmSync, readFileSync, writeFileSync, renameSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

/**
 * Tests for FileSyncState — the sync state persistence layer.
 * We re-implement the core logic here to test it in isolation
 * (the real class reads from ~/.kent/state.json).
 */

interface StateData {
  lastSync: Record<string, number>;
}

class TestSyncState {
  private data: StateData;
  private statePath: string;
  private dir: string;

  constructor(dir: string) {
    this.dir = dir;
    this.statePath = join(dir, "state.json");
    this.data = this.load();
  }

  private load(): StateData {
    try {
      if (existsSync(this.statePath)) {
        const raw = readFileSync(this.statePath, "utf-8");
        const parsed = JSON.parse(raw);
        return { lastSync: parsed.lastSync || {} };
      }
    } catch {
      // fall through
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
  let tempDir: string;

  beforeEach(() => {
    tempDir = join(tmpdir(), `kent-test-syncstate-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(tempDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  test("returns 0 for unknown source", () => {
    const state = new TestSyncState(tempDir);
    expect(state.getLastSync("imessage")).toBe(0);
    expect(state.getLastSync("gmail")).toBe(0);
    expect(state.getLastSync("nonexistent")).toBe(0);
  });

  test("markSynced persists timestamp to disk", () => {
    const state = new TestSyncState(tempDir);
    const before = Math.floor(Date.now() / 1000);

    state.markSynced("imessage");

    const after = Math.floor(Date.now() / 1000);
    const lastSync = state.getLastSync("imessage");

    expect(lastSync).toBeGreaterThanOrEqual(before);
    expect(lastSync).toBeLessThanOrEqual(after);

    // Verify it was written to disk
    const statePath = join(tempDir, "state.json");
    expect(existsSync(statePath)).toBe(true);

    const raw = readFileSync(statePath, "utf-8");
    const data = JSON.parse(raw);
    expect(data.lastSync.imessage).toBe(lastSync);
  });

  test("markSynced tracks multiple sources independently", () => {
    const state = new TestSyncState(tempDir);

    state.markSynced("imessage");
    const imessageTime = state.getLastSync("imessage");

    state.markSynced("gmail");
    const gmailTime = state.getLastSync("gmail");

    expect(imessageTime).toBeGreaterThan(0);
    expect(gmailTime).toBeGreaterThanOrEqual(imessageTime);
    expect(state.getLastSync("github")).toBe(0); // untouched
  });

  test("state survives reload from disk", () => {
    const state1 = new TestSyncState(tempDir);
    state1.markSynced("github");
    const originalTime = state1.getLastSync("github");

    // Create a new instance that reads from the same disk file
    const state2 = new TestSyncState(tempDir);
    expect(state2.getLastSync("github")).toBe(originalTime);
  });

  test("handles corrupted state file gracefully", () => {
    const statePath = join(tempDir, "state.json");
    writeFileSync(statePath, "corrupt{{{json", "utf-8");

    const state = new TestSyncState(tempDir);
    expect(state.getLastSync("imessage")).toBe(0);

    // Should still be able to write new state
    state.markSynced("imessage");
    expect(state.getLastSync("imessage")).toBeGreaterThan(0);
  });

  test("handles missing lastSync key in state file", () => {
    const statePath = join(tempDir, "state.json");
    writeFileSync(statePath, JSON.stringify({ otherKey: "value" }), "utf-8");

    const state = new TestSyncState(tempDir);
    expect(state.getLastSync("imessage")).toBe(0);
  });

  test("atomic write uses temp file", () => {
    const state = new TestSyncState(tempDir);
    state.markSynced("test");

    // After save, only state.json should exist (temp file renamed)
    const statePath = join(tempDir, "state.json");
    const tempPath = join(tempDir, "state.json.tmp");

    expect(existsSync(statePath)).toBe(true);
    expect(existsSync(tempPath)).toBe(false);
  });

  test("creates directory if it does not exist", () => {
    const nestedDir = join(tempDir, "nested", "deep");
    const state = new TestSyncState(nestedDir);
    state.markSynced("test");

    expect(existsSync(join(nestedDir, "state.json"))).toBe(true);
  });
});
