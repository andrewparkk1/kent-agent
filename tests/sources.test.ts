import { test, expect, describe } from "bun:test";
import type { SyncState, Item, Source } from "@daemon/sources/types.ts";

// Mock SyncState for testing
class MockSyncState implements SyncState {
  private timestamps: Record<string, number> = {};

  getLastSync(source: string): number {
    return this.timestamps[source] || 0;
  }

  markSynced(source: string): void {
    this.timestamps[source] = Math.floor(Date.now() / 1000);
  }
}

describe("Source types", () => {
  test("Item interface has required fields", () => {
    const item: Item = {
      source: "test",
      externalId: "test-1",
      content: "hello",
      metadata: {},
      createdAt: Date.now(),
    };

    expect(item.source).toBe("test");
    expect(item.externalId).toBe("test-1");
    expect(item.content).toBe("hello");
    expect(item.metadata).toEqual({});
    expect(item.createdAt).toBeGreaterThan(0);
  });

  test("SyncState mock works correctly", () => {
    const state = new MockSyncState();

    expect(state.getLastSync("test")).toBe(0);
    state.markSynced("test");
    expect(state.getLastSync("test")).toBeGreaterThan(0);
  });
});

describe("iMessage source", () => {
  test("imessage source has correct name", async () => {
    const { imessage } = await import("@daemon/sources/imessage.ts");

    expect(imessage.name).toBe("imessage");
    expect(typeof imessage.fetchNew).toBe("function");
  });

  test("imessage fetchNew returns array (may be empty without DB access)", async () => {
    const { imessage } = await import("@daemon/sources/imessage.ts");
    const state = new MockSyncState();

    const items = await imessage.fetchNew(state);
    expect(items).toBeArray();
    // Each item should have the right shape if any exist
    for (const item of items) {
      expect(item.source).toBe("imessage");
      expect(item.externalId).toMatch(/^imessage-/);
      expect(item.content).toBeString();
      expect(item.createdAt).toBeNumber();
    }
  });
});

describe("Gmail source", () => {
  test("gmail source has correct name", async () => {
    const { gmail } = await import("@daemon/sources/gmail.ts");

    expect(gmail.name).toBe("gmail");
    expect(typeof gmail.fetchNew).toBe("function");
  });

  test("gmail fetchNew returns array (may be empty without gws)", async () => {
    const { gmail } = await import("@daemon/sources/gmail.ts");
    const state = new MockSyncState();

    const items = await gmail.fetchNew(state);
    expect(items).toBeArray();
    for (const item of items) {
      expect(item.source).toBe("gmail");
      expect(item.externalId).toMatch(/^(gmail-|gcal-|gtask-)/);
    }
  });
});

describe("GitHub source", () => {
  test("github source has correct name", async () => {
    const { github } = await import("@daemon/sources/github.ts");

    expect(github.name).toBe("github");
    expect(typeof github.fetchNew).toBe("function");
  });

  test("github fetchNew returns array", async () => {
    const { github } = await import("@daemon/sources/github.ts");
    const state = new MockSyncState();

    const items = await github.fetchNew(state);
    expect(items).toBeArray();
    for (const item of items) {
      expect(item.source).toBe("github");
      expect(item.externalId).toMatch(/^github-/);
    }
  });
});

describe("Signal source", () => {
  test("signal source has correct name", async () => {
    const { signal } = await import("@daemon/sources/signal.ts");

    expect(signal.name).toBe("signal");
    expect(typeof signal.fetchNew).toBe("function");
  });
});

describe("Granola source", () => {
  test("granola source has correct name", async () => {
    const { granola } = await import("@daemon/sources/granola.ts");

    expect(granola.name).toBe("granola");
    expect(typeof granola.fetchNew).toBe("function");
  });
});

describe("Chrome source", () => {
  test("chrome source has correct name", async () => {
    const { chrome } = await import("@daemon/sources/chrome.ts");

    expect(chrome.name).toBe("chrome");
    expect(typeof chrome.fetchNew).toBe("function");
  });
});

describe("Apple Notes source", () => {
  test("apple notes source has correct name", async () => {
    const { appleNotes } = await import("@daemon/sources/apple-notes.ts");

    expect(appleNotes.name).toBe("apple-notes");
    expect(typeof appleNotes.fetchNew).toBe("function");
  });
});

describe("Source registry in sync command", () => {
  test("all 7 sources are importable and conform to Source interface", async () => {
    const sources: Source[] = [
      (await import("@daemon/sources/imessage.ts")).imessage,
      (await import("@daemon/sources/signal.ts")).signal,
      (await import("@daemon/sources/granola.ts")).granola,
      (await import("@daemon/sources/gmail.ts")).gmail,
      (await import("@daemon/sources/github.ts")).github,
      (await import("@daemon/sources/chrome.ts")).chrome,
      (await import("@daemon/sources/apple-notes.ts")).appleNotes,
    ];

    expect(sources.length).toBe(7);

    const names = sources.map((s) => s.name);
    expect(names).toContain("imessage");
    expect(names).toContain("signal");
    expect(names).toContain("granola");
    expect(names).toContain("gmail");
    expect(names).toContain("github");
    expect(names).toContain("chrome");
    expect(names).toContain("apple-notes");

    for (const source of sources) {
      expect(typeof source.name).toBe("string");
      expect(typeof source.fetchNew).toBe("function");
    }
  });
});
