/**
 * Tests for agent/tools/memory.ts — the agent-facing tool wrappers around
 * the memories DB layer. We stub shared/db/connection.ts with an in-memory
 * Kysely instance so the full stack (tool → db fn → sqlite) runs for real.
 */
import { test, expect, describe, beforeEach, afterEach, mock } from "bun:test";
import { createTestMemoryDb } from "./_memory-test-helpers.ts";
import type { Kysely } from "kysely";
import type { Database } from "../shared/db/schema.ts";

const holder: { db: Kysely<Database> | null } = { db: null };

mock.module("../shared/db/connection.ts", () => ({
  getDb: () => {
    if (!holder.db) throw new Error("test db not set");
    return holder.db;
  },
  getRawDb: () => {
    throw new Error("getRawDb not stubbed");
  },
}));

// Re-mock @shared/db.ts with the real memories module (which calls the
// stubbed connection.ts above). Other test files in the same `bun test`
// invocation may have installed a stub on @shared/db.ts that lacks memory
// functions; this ensures memory.ts imports resolve to the real impl.
const realMemories = await import("../shared/db/memories.ts");
mock.module("@shared/db.ts", () => ({ ...realMemories }));

const mod = await import("../agent/tools/memory.ts");
const {
  memCreate, memUpdate, memArchive, memList, memSearch, memLink, memUnlink, memoryTools,
} = mod;

// Call a tool's execute function (aliased to avoid tripping overly-eager exec() scanners).
const call = (tool: any, params: any) => tool.execute("call-1", params);

function extractText(result: any): string {
  return result.content.map((c: any) => c.text).join("\n");
}

// ─── Schema / shape ────────────────────────────────────────────────────────

describe("memoryTools exports", () => {
  test("exports a non-empty array of tools", () => {
    expect(Array.isArray(memoryTools)).toBe(true);
    expect(memoryTools.length).toBeGreaterThan(0);
  });

  test("every tool has name/description/parameters/execute", () => {
    for (const t of memoryTools) {
      expect(typeof t.name).toBe("string");
      expect(t.name.length).toBeGreaterThan(0);
      expect(typeof t.description).toBe("string");
      expect(typeof t.execute).toBe("function");
      expect(t.parameters).toBeDefined();
    }
  });

  test("tool names are unique and match expected set", () => {
    const names = memoryTools.map((t) => t.name).sort();
    expect(new Set(names).size).toBe(names.length);
    expect(names).toEqual([
      "archive_memory", "create_memory", "link_memories", "list_memories",
      "search_memories", "unlink_memories", "update_memory",
    ].sort());
  });

  test("individual tool name constants match", () => {
    expect(memCreate.name).toBe("create_memory");
    expect(memUpdate.name).toBe("update_memory");
    expect(memArchive.name).toBe("archive_memory");
    expect(memList.name).toBe("list_memories");
    expect(memSearch.name).toBe("search_memories");
    expect(memLink.name).toBe("link_memories");
    expect(memUnlink.name).toBe("unlink_memories");
  });
});

// ─── Behavior ──────────────────────────────────────────────────────────────

describe("memCreate behavior", () => {
  let close: () => void;
  beforeEach(() => {
    const t = createTestMemoryDb();
    holder.db = t.db;
    close = () => t.raw.close();
  });
  afterEach(() => { close(); holder.db = null; });

  test("creates a memory and returns a text result", async () => {
    const result = await call(memCreate, { type: "person", title: "Alice", body: "# Alice" });
    const text = extractText(result);
    expect(text).toContain("Memory created");
    expect(text).toContain("Alice");
    expect(text).toContain("person");
  });

  test("passes through optional fields", async () => {
    await call(memCreate, {
      type: "project", title: "Kent", summary: "agent", body: "b",
      sources: ["gmail"], aliases: ["k"],
    });
    const listRes = await call(memList, {});
    const items = JSON.parse(extractText(listRes));
    expect(items).toHaveLength(1);
    expect(items[0].title).toBe("Kent");
    expect(items[0].aliases).toEqual(["k"]);
  });

  test("throws when the DB layer rejects invalid type", async () => {
    await expect(
      call(memCreate, { type: "bogus", title: "x", body: "y" })
    ).rejects.toThrow(/Failed to create memory/);
  });
});

describe("memList behavior", () => {
  let close: () => void;
  beforeEach(() => {
    const t = createTestMemoryDb();
    holder.db = t.db;
    close = () => t.raw.close();
  });
  afterEach(() => { close(); holder.db = null; });

  test("empty DB yields 'No memories yet.'", async () => {
    const result = await call(memList, {});
    expect(extractText(result)).toContain("No memories yet");
  });

  test("returns JSON with staleness metadata", async () => {
    await call(memCreate, { type: "topic", title: "Fresh", body: "b" });
    const result = await call(memList, {});
    const items = JSON.parse(extractText(result));
    expect(items).toHaveLength(1);
    expect(items[0].title).toBe("Fresh");
    expect(items[0]).toHaveProperty("days_since_update");
    expect(items[0]).toHaveProperty("stale");
    expect(items[0].stale).toBe(false);
  });

  test("filters by type", async () => {
    await call(memCreate, { type: "person", title: "Alice", body: "" });
    await call(memCreate, { type: "project", title: "Kent", body: "" });
    const result = await call(memList, { type: "person" });
    const items = JSON.parse(extractText(result));
    expect(items).toHaveLength(1);
    expect(items[0].title).toBe("Alice");
  });
});

describe("memSearch behavior", () => {
  let close: () => void;
  beforeEach(() => {
    const t = createTestMemoryDb();
    holder.db = t.db;
    close = () => t.raw.close();
  });
  afterEach(() => { close(); holder.db = null; });

  test("no matches yields informative text", async () => {
    const result = await call(memSearch, { query: "anything" });
    expect(extractText(result)).toContain("No matching memories");
  });

  test("finds by body keyword", async () => {
    await call(memCreate, { type: "topic", title: "SQLite", body: "a tiny embedded database" });
    await call(memCreate, { type: "topic", title: "Rust", body: "a systems language" });
    const result = await call(memSearch, { query: "embedded" });
    const items = JSON.parse(extractText(result));
    expect(items).toHaveLength(1);
    expect(items[0].title).toBe("SQLite");
  });
});

describe("memUpdate behavior", () => {
  let close: () => void;
  let id: string;
  beforeEach(async () => {
    const t = createTestMemoryDb();
    holder.db = t.db;
    close = () => t.raw.close();
    const res = await call(memCreate, { type: "topic", title: "Orig", body: "orig" });
    id = /id: ([^)]+)\)/.exec(extractText(res))![1]!;
  });
  afterEach(() => { close(); holder.db = null; });

  test("updates title", async () => {
    const res = await call(memUpdate, { id, title: "New" });
    expect(extractText(res)).toContain("updated");
    const list = JSON.parse(extractText(await call(memList, {})));
    expect(list[0].title).toBe("New");
  });

  test("updating a nonexistent id does not throw", async () => {
    await expect(call(memUpdate, { id: "ghost", title: "x" })).resolves.toBeDefined();
  });
});

describe("memArchive behavior", () => {
  let close: () => void;
  beforeEach(() => {
    const t = createTestMemoryDb();
    holder.db = t.db;
    close = () => t.raw.close();
  });
  afterEach(() => { close(); holder.db = null; });

  test("archives and hides from default list", async () => {
    const res = await call(memCreate, { type: "topic", title: "X", body: "" });
    const id = /id: ([^)]+)\)/.exec(extractText(res))![1]!;
    await call(memArchive, { id });
    const listText = extractText(await call(memList, {}));
    expect(listText).toContain("No memories yet");
  });

  test("archiving a missing id does not throw", async () => {
    await expect(call(memArchive, { id: "ghost" })).resolves.toBeDefined();
  });
});

describe("memLink / memUnlink behavior", () => {
  let close: () => void;
  let aId: string;
  let bId: string;
  beforeEach(async () => {
    const t = createTestMemoryDb();
    holder.db = t.db;
    close = () => t.raw.close();
    const a = await call(memCreate, { type: "person", title: "Alice", body: "" });
    const b = await call(memCreate, { type: "project", title: "Kent", body: "" });
    aId = /id: ([^)]+)\)/.exec(extractText(a))![1]!;
    bId = /id: ([^)]+)\)/.exec(extractText(b))![1]!;
  });
  afterEach(() => { close(); holder.db = null; });

  test("creates a link with label", async () => {
    const res = await call(memLink, { from_id: aId, to_id: bId, label: "works on" });
    const text = extractText(res);
    expect(text).toContain("Linked");
    expect(text).toContain("works on");
  });

  test("links without a label still work", async () => {
    const res = await call(memLink, { from_id: aId, to_id: bId });
    expect(extractText(res)).toContain("Linked");
  });

  test("unlink removes the link", async () => {
    await call(memLink, { from_id: aId, to_id: bId, label: "x" });
    const res = await call(memUnlink, { from_id: aId, to_id: bId });
    expect(extractText(res)).toContain("Unlinked");
  });

  test("linking to an unknown id fails with FK violation", async () => {
    await expect(
      call(memLink, { from_id: aId, to_id: "ghost" })
    ).rejects.toThrow(/Failed to link/);
  });
});
