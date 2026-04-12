/**
 * Tests for shared/db/memories.ts — the Kysely-backed memories CRUD layer.
 *
 * We stub shared/db/connection.ts with a getDb() that returns an in-memory
 * Kysely instance. This runs the real memories.ts code (no duplication) but
 * with zero filesystem side-effects.
 */
import { test, expect, describe, beforeEach, afterEach, mock } from "bun:test";
import { createTestMemoryDb } from "./_memory-test-helpers.ts";
import type { Kysely } from "kysely";
import type { Database } from "../shared/db/schema.ts";

// Holder the stub reads from so each test can swap dbs.
const holder: { db: Kysely<Database> | null } = { db: null };

mock.module("../shared/db/connection.ts", () => ({
  getDb: () => {
    if (!holder.db) throw new Error("test db not set");
    return holder.db;
  },
  getRawDb: () => {
    throw new Error("getRawDb not stubbed in memories-db tests");
  },
}));

// Import AFTER mock registration.
const mem = await import("../shared/db/memories.ts");

describe("createMemory", () => {
  let raw: ReturnType<typeof createTestMemoryDb>["raw"];
  beforeEach(() => {
    const t = createTestMemoryDb();
    holder.db = t.db;
    raw = t.raw;
  });
  afterEach(() => { raw.close(); holder.db = null; });

  test("inserts a memory with minimal fields and returns an id", async () => {
    const id = await mem.createMemory({ type: "person", title: "Alice", body: "# Alice" });
    expect(typeof id).toBe("string");
    expect(id.length).toBeGreaterThan(0);

    const row = raw.prepare("SELECT * FROM memories WHERE id = ?").get(id) as any;
    expect(row).not.toBeNull();
    expect(row.title).toBe("Alice");
    expect(row.type).toBe("person");
    expect(row.body).toBe("# Alice");
    expect(row.summary).toBe("");
    expect(row.sources).toBe("[]");
    expect(row.aliases).toBe("[]");
    expect(row.is_archived).toBe(0);
  });

  test("persists summary, sources, aliases as JSON", async () => {
    const id = await mem.createMemory({
      type: "project",
      title: "Kent",
      summary: "The agent",
      body: "body",
      sources: ["gmail", "imessage"],
      aliases: ["kent-agent", "k"],
    });
    const row = raw.prepare("SELECT * FROM memories WHERE id = ?").get(id) as any;
    expect(row.summary).toBe("The agent");
    expect(JSON.parse(row.sources)).toEqual(["gmail", "imessage"]);
    expect(JSON.parse(row.aliases)).toEqual(["kent-agent", "k"]);
  });

  test("rejects invalid type via CHECK constraint", async () => {
    await expect(
      mem.createMemory({ type: "nonsense" as any, title: "x", body: "y" })
    ).rejects.toThrow();
  });

  test("each created id is unique", async () => {
    const ids = await Promise.all([
      mem.createMemory({ type: "topic", title: "a", body: "a" }),
      mem.createMemory({ type: "topic", title: "b", body: "b" }),
      mem.createMemory({ type: "topic", title: "c", body: "c" }),
    ]);
    expect(new Set(ids).size).toBe(3);
  });
});

describe("getMemory", () => {
  let raw: ReturnType<typeof createTestMemoryDb>["raw"];
  beforeEach(() => {
    const t = createTestMemoryDb();
    holder.db = t.db;
    raw = t.raw;
  });
  afterEach(() => { raw.close(); holder.db = null; });

  test("returns the memory row", async () => {
    const id = await mem.createMemory({ type: "topic", title: "Foo", body: "bar" });
    const got = await mem.getMemory(id);
    expect(got).toBeDefined();
    expect(got!.id).toBe(id);
    expect(got!.title).toBe("Foo");
  });

  test("returns undefined for unknown id", async () => {
    const got = await mem.getMemory("nope");
    expect(got).toBeUndefined();
  });
});

describe("listMemories", () => {
  let raw: ReturnType<typeof createTestMemoryDb>["raw"];
  beforeEach(() => {
    const t = createTestMemoryDb();
    holder.db = t.db;
    raw = t.raw;
  });
  afterEach(() => { raw.close(); holder.db = null; });

  test("empty db returns empty array", async () => {
    const list = await mem.listMemories();
    expect(list).toEqual([]);
  });

  test("returns only non-archived by default", async () => {
    const a = await mem.createMemory({ type: "topic", title: "A", body: "a" });
    await mem.createMemory({ type: "topic", title: "B", body: "b" });
    await mem.archiveMemory(a);

    const list = await mem.listMemories();
    expect(list).toHaveLength(1);
    expect(list[0]!.title).toBe("B");
  });

  test("includeArchived=true returns everything", async () => {
    const a = await mem.createMemory({ type: "topic", title: "A", body: "a" });
    await mem.createMemory({ type: "topic", title: "B", body: "b" });
    await mem.archiveMemory(a);

    const list = await mem.listMemories({ includeArchived: true });
    expect(list).toHaveLength(2);
  });

  test("filters by type", async () => {
    await mem.createMemory({ type: "person", title: "Alice", body: "x" });
    await mem.createMemory({ type: "project", title: "Kent", body: "y" });
    await mem.createMemory({ type: "topic", title: "DB", body: "z" });

    const people = await mem.listMemories({ type: "person" });
    expect(people).toHaveLength(1);
    expect(people[0]!.title).toBe("Alice");
  });

  test("orders by updated_at desc", async () => {
    const a = await mem.createMemory({ type: "topic", title: "A", body: "a" });
    const b = await mem.createMemory({ type: "topic", title: "B", body: "b" });
    // Bump A's updated_at so it should come first
    raw.prepare("UPDATE memories SET updated_at = 9999999999 WHERE id = ?").run(a);

    const list = await mem.listMemories();
    expect(list[0]!.id).toBe(a);
    expect(list[1]!.id).toBe(b);
  });
});

describe("updateMemory", () => {
  let raw: ReturnType<typeof createTestMemoryDb>["raw"];
  beforeEach(() => {
    const t = createTestMemoryDb();
    holder.db = t.db;
    raw = t.raw;
  });
  afterEach(() => { raw.close(); holder.db = null; });

  test("updates scalar fields", async () => {
    const id = await mem.createMemory({ type: "topic", title: "Old", body: "old" });
    await mem.updateMemory(id, { title: "New", summary: "s", body: "new", type: "project" });

    const got = await mem.getMemory(id);
    expect(got!.title).toBe("New");
    expect(got!.summary).toBe("s");
    expect(got!.body).toBe("new");
    expect(got!.type).toBe("project");
  });

  test("serializes sources and aliases arrays to JSON", async () => {
    const id = await mem.createMemory({ type: "topic", title: "t", body: "b" });
    await mem.updateMemory(id, { sources: ["a", "b"], aliases: ["x"] });

    const row = raw.prepare("SELECT sources, aliases FROM memories WHERE id = ?").get(id) as any;
    expect(JSON.parse(row.sources)).toEqual(["a", "b"]);
    expect(JSON.parse(row.aliases)).toEqual(["x"]);
  });

  test("bumps updated_at", async () => {
    const id = await mem.createMemory({ type: "topic", title: "t", body: "b" });
    raw.prepare("UPDATE memories SET updated_at = 1000 WHERE id = ?").run(id);
    await mem.updateMemory(id, { title: "new" });
    const row = raw.prepare("SELECT updated_at FROM memories WHERE id = ?").get(id) as any;
    expect(row.updated_at).toBeGreaterThan(1000);
  });

  test("updating unknown id is a no-op (does not throw)", async () => {
    await expect(mem.updateMemory("ghost", { title: "x" })).resolves.toBeUndefined();
  });
});

describe("archiveMemory", () => {
  let raw: ReturnType<typeof createTestMemoryDb>["raw"];
  beforeEach(() => {
    const t = createTestMemoryDb();
    holder.db = t.db;
    raw = t.raw;
  });
  afterEach(() => { raw.close(); holder.db = null; });

  test("flips is_archived to 1", async () => {
    const id = await mem.createMemory({ type: "topic", title: "t", body: "b" });
    await mem.archiveMemory(id);
    const row = raw.prepare("SELECT is_archived FROM memories WHERE id = ?").get(id) as any;
    expect(row.is_archived).toBe(1);
  });

  test("double-archive is idempotent", async () => {
    const id = await mem.createMemory({ type: "topic", title: "t", body: "b" });
    await mem.archiveMemory(id);
    await mem.archiveMemory(id);
    const row = raw.prepare("SELECT is_archived FROM memories WHERE id = ?").get(id) as any;
    expect(row.is_archived).toBe(1);
  });

  test("unarchive via updateMemory is_archived=0", async () => {
    const id = await mem.createMemory({ type: "topic", title: "t", body: "b" });
    await mem.archiveMemory(id);
    await mem.updateMemory(id, { is_archived: 0 });
    const list = await mem.listMemories();
    expect(list.find((m) => m.id === id)).toBeDefined();
  });

  test("archiving missing id does not throw", async () => {
    await expect(mem.archiveMemory("ghost")).resolves.toBeUndefined();
  });
});

describe("searchMemories", () => {
  let raw: ReturnType<typeof createTestMemoryDb>["raw"];
  beforeEach(() => {
    const t = createTestMemoryDb();
    holder.db = t.db;
    raw = t.raw;
  });
  afterEach(() => { raw.close(); holder.db = null; });

  test("finds by title substring", async () => {
    await mem.createMemory({ type: "person", title: "Alice Wonderland", body: "x" });
    await mem.createMemory({ type: "person", title: "Bob", body: "x" });

    const out = await mem.searchMemories("Alice");
    expect(out).toHaveLength(1);
    expect(out[0]!.title).toBe("Alice Wonderland");
  });

  test("finds by summary, body, and alias", async () => {
    await mem.createMemory({
      type: "project",
      title: "X",
      summary: "wizard stuff",
      body: "nothing",
      aliases: [],
    });
    await mem.createMemory({
      type: "project",
      title: "Y",
      body: "contains wizard",
      aliases: [],
    });
    await mem.createMemory({
      type: "project",
      title: "Z",
      body: "nothing",
      aliases: ["wizard-alias"],
    });

    const res = await mem.searchMemories("wizard");
    expect(res.map((r) => r.title).sort()).toEqual(["X", "Y", "Z"]);
  });

  test("excludes archived memories", async () => {
    const id = await mem.createMemory({ type: "topic", title: "findme", body: "b" });
    await mem.archiveMemory(id);
    const res = await mem.searchMemories("findme");
    expect(res).toHaveLength(0);
  });

  test("empty results for no match", async () => {
    await mem.createMemory({ type: "topic", title: "a", body: "b" });
    const res = await mem.searchMemories("zzznope");
    expect(res).toEqual([]);
  });
});

describe("deleteMemory", () => {
  let raw: ReturnType<typeof createTestMemoryDb>["raw"];
  beforeEach(() => {
    const t = createTestMemoryDb();
    holder.db = t.db;
    raw = t.raw;
  });
  afterEach(() => { raw.close(); holder.db = null; });

  test("removes the row and returns true", async () => {
    const id = await mem.createMemory({ type: "topic", title: "t", body: "b" });
    const ok = await mem.deleteMemory(id);
    expect(ok).toBe(true);
    const row = raw.prepare("SELECT * FROM memories WHERE id = ?").get(id);
    expect(row).toBeNull();
  });

  test("returns false for unknown id", async () => {
    const ok = await mem.deleteMemory("ghost");
    expect(ok).toBe(false);
  });

  test("cascades to memory_links", async () => {
    const a = await mem.createMemory({ type: "topic", title: "A", body: "" });
    const b = await mem.createMemory({ type: "topic", title: "B", body: "" });
    await mem.linkMemories(a, b, "related");

    await mem.deleteMemory(a);
    const links = raw.prepare("SELECT * FROM memory_links").all() as any[];
    expect(links).toHaveLength(0);
  });
});

describe("memory links", () => {
  let raw: ReturnType<typeof createTestMemoryDb>["raw"];
  beforeEach(() => {
    const t = createTestMemoryDb();
    holder.db = t.db;
    raw = t.raw;
  });
  afterEach(() => { raw.close(); holder.db = null; });

  test("linkMemories inserts a directed link", async () => {
    const a = await mem.createMemory({ type: "person", title: "Alice", body: "" });
    const b = await mem.createMemory({ type: "project", title: "Kent", body: "" });
    await mem.linkMemories(a, b, "works on");

    const rows = raw.prepare("SELECT * FROM memory_links").all() as any[];
    expect(rows).toHaveLength(1);
    expect(rows[0].from_id).toBe(a);
    expect(rows[0].to_id).toBe(b);
    expect(rows[0].label).toBe("works on");
  });

  test("re-linking same pair upserts the label", async () => {
    const a = await mem.createMemory({ type: "person", title: "A", body: "" });
    const b = await mem.createMemory({ type: "project", title: "B", body: "" });
    await mem.linkMemories(a, b, "old");
    await mem.linkMemories(a, b, "new");

    const rows = raw.prepare("SELECT * FROM memory_links").all() as any[];
    expect(rows).toHaveLength(1);
    expect(rows[0].label).toBe("new");
  });

  test("unlinkMemories removes the link", async () => {
    const a = await mem.createMemory({ type: "person", title: "A", body: "" });
    const b = await mem.createMemory({ type: "project", title: "B", body: "" });
    await mem.linkMemories(a, b);
    await mem.unlinkMemories(a, b);
    const rows = raw.prepare("SELECT * FROM memory_links").all() as any[];
    expect(rows).toHaveLength(0);
  });

  test("getLinkedMemories returns outgoing non-archived", async () => {
    const a = await mem.createMemory({ type: "person", title: "A", body: "" });
    const b = await mem.createMemory({ type: "project", title: "B", body: "" });
    const c = await mem.createMemory({ type: "topic", title: "C", body: "" });
    await mem.linkMemories(a, b, "to B");
    await mem.linkMemories(a, c, "to C");
    await mem.archiveMemory(c);

    const out = await mem.getLinkedMemories(a);
    expect(out).toHaveLength(1);
    expect(out[0]!.title).toBe("B");
    expect(out[0]!.link_label).toBe("to B");
  });

  test("getBacklinks returns incoming non-archived", async () => {
    const a = await mem.createMemory({ type: "person", title: "A", body: "" });
    const b = await mem.createMemory({ type: "project", title: "B", body: "" });
    await mem.linkMemories(a, b, "writes");

    const back = await mem.getBacklinks(b);
    expect(back).toHaveLength(1);
    expect(back[0]!.title).toBe("A");
    expect(back[0]!.link_label).toBe("writes");
  });

  test("getAllLinks returns both directions", async () => {
    const a = await mem.createMemory({ type: "person", title: "A", body: "" });
    const b = await mem.createMemory({ type: "project", title: "B", body: "" });
    const c = await mem.createMemory({ type: "topic", title: "C", body: "" });
    await mem.linkMemories(a, b);
    await mem.linkMemories(c, a);

    const all = await mem.getAllLinks(a);
    expect(all.outgoing).toHaveLength(1);
    expect(all.outgoing[0]!.title).toBe("B");
    expect(all.incoming).toHaveLength(1);
    expect(all.incoming[0]!.title).toBe("C");
  });

  test("empty links for isolated memory", async () => {
    const a = await mem.createMemory({ type: "person", title: "A", body: "" });
    const all = await mem.getAllLinks(a);
    expect(all.outgoing).toEqual([]);
    expect(all.incoming).toEqual([]);
  });
});
