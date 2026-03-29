import { test, expect, describe, beforeEach } from "bun:test";
import type { Source, SyncState, Item } from "@daemon/sources/types.ts";

/**
 * Tests for daemon/sync-engine.ts — the SyncEngine class.
 *
 * Uses mock sources and a mock Convex client to test orchestration logic
 * without hitting real databases or APIs.
 */

class MockSyncState implements SyncState {
  private timestamps: Record<string, number> = {};

  getLastSync(source: string): number {
    return this.timestamps[source] || 0;
  }

  markSynced(source: string): void {
    this.timestamps[source] = Math.floor(Date.now() / 1000);
  }
}

function createMockSource(name: string, items: Item[]): Source {
  return {
    name,
    fetchNew: async (_state: SyncState) => items,
  };
}

function createFailingSource(name: string, error: string): Source {
  return {
    name,
    fetchNew: async () => {
      throw new Error(error);
    },
  };
}

function createMockConvexClient() {
  const calls: Array<{ method: string; args: any }> = [];
  return {
    calls,
    mutation: async (path: string, args: any) => {
      calls.push({ method: path, args });
    },
  };
}

describe("SyncEngine", () => {
  let state: MockSyncState;
  let convexClient: ReturnType<typeof createMockConvexClient>;

  beforeEach(() => {
    state = new MockSyncState();
    convexClient = createMockConvexClient();
  });

  test("SyncEngine can be instantiated", async () => {
    const { SyncEngine } = await import("../daemon/sync-engine.ts");
    const engine = new SyncEngine([], convexClient, "test-token");
    expect(engine).toBeDefined();
  });

  test("runOnce with no sources does nothing", async () => {
    const { SyncEngine } = await import("../daemon/sync-engine.ts");
    const engine = new SyncEngine([], convexClient, "test-token");

    await engine.runOnce();
    expect(convexClient.calls.length).toBe(0);
  });

  test("runOnce fetches items from sources and calls convex", async () => {
    const { SyncEngine } = await import("../daemon/sync-engine.ts");

    const items: Item[] = [
      { source: "test", externalId: "test-1", content: "hello", metadata: {}, createdAt: Date.now() },
      { source: "test", externalId: "test-2", content: "world", metadata: {}, createdAt: Date.now() },
    ];

    const source = createMockSource("test", items);
    const engine = new SyncEngine([source], convexClient, "device-tok");

    await engine.runOnce();

    expect(convexClient.calls.length).toBe(1);
    expect(convexClient.calls[0].method).toBe("items:batchUpsert");
    expect(convexClient.calls[0].args.deviceToken).toBe("device-tok");
    expect(convexClient.calls[0].args.items).toHaveLength(2);
  });

  test("runOnce skips convex call when source returns empty array", async () => {
    const { SyncEngine } = await import("../daemon/sync-engine.ts");

    const source = createMockSource("empty", []);
    const engine = new SyncEngine([source], convexClient, "test-token");

    await engine.runOnce();

    expect(convexClient.calls.length).toBe(0);
  });

  test("runOnce handles multiple sources", async () => {
    const { SyncEngine } = await import("../daemon/sync-engine.ts");

    const items1: Item[] = [
      { source: "imessage", externalId: "im-1", content: "msg1", metadata: {}, createdAt: 1 },
    ];
    const items2: Item[] = [
      { source: "gmail", externalId: "gm-1", content: "email1", metadata: {}, createdAt: 2 },
      { source: "gmail", externalId: "gm-2", content: "email2", metadata: {}, createdAt: 3 },
    ];

    const source1 = createMockSource("imessage", items1);
    const source2 = createMockSource("gmail", items2);
    const engine = new SyncEngine([source1, source2], convexClient, "tok");

    await engine.runOnce();

    expect(convexClient.calls.length).toBe(2);
    expect(convexClient.calls[0].args.items).toHaveLength(1);
    expect(convexClient.calls[1].args.items).toHaveLength(2);
  });

  test("runOnce continues after source failure", async () => {
    const { SyncEngine } = await import("../daemon/sync-engine.ts");

    const failingSource = createFailingSource("broken", "DB not found");
    const workingItems: Item[] = [
      { source: "working", externalId: "w-1", content: "ok", metadata: {}, createdAt: 1 },
    ];
    const workingSource = createMockSource("working", workingItems);

    const engine = new SyncEngine([failingSource, workingSource], convexClient, "tok");

    // Should not throw
    await engine.runOnce();

    // Working source should still have been synced
    expect(convexClient.calls.length).toBe(1);
    expect(convexClient.calls[0].args.items[0].source).toBe("working");
  });

  test("runOnce passes SyncState to sources", async () => {
    const { SyncEngine } = await import("../daemon/sync-engine.ts");

    let receivedState: SyncState | null = null;
    const source: Source = {
      name: "spy",
      fetchNew: async (state) => {
        receivedState = state;
        return [];
      },
    };

    const engine = new SyncEngine([source], convexClient, "tok");
    await engine.runOnce();

    expect(receivedState).not.toBeNull();
    expect(typeof receivedState!.getLastSync).toBe("function");
    expect(typeof receivedState!.markSynced).toBe("function");
  });
});

describe("SyncEngine with convex failures", () => {
  test("runOnce handles convex mutation failure gracefully", async () => {
    const { SyncEngine } = await import("../daemon/sync-engine.ts");

    const failingClient = {
      mutation: async () => {
        throw new Error("Network error");
      },
    };

    const items: Item[] = [
      { source: "test", externalId: "t-1", content: "data", metadata: {}, createdAt: 1 },
    ];
    const source = createMockSource("test", items);

    const engine = new SyncEngine([source], failingClient, "tok");

    // Should not throw — errors are caught per-source
    await engine.runOnce();
  });
});
