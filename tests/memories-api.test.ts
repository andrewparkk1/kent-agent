/**
 * Tests for web/api/memories.ts — HTTP handlers that call into the memories
 * DB layer. We stub shared/db/connection.ts so the handlers execute against
 * an in-memory SQLite database. Each handler is called directly with a
 * synthetic Request object; no HTTP server is started.
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
// invocation may install a stub on @shared/db.ts that lacks getAllLinks
// or other memory exports; this ensures memories.ts imports resolve correctly.
const realMemoriesMod = await import("../shared/db/memories.ts");
mock.module("@shared/db.ts", () => ({ ...realMemoriesMod }));

// Import handlers AFTER the mock is registered.
const api = await import("../web/api/memories.ts");
// Also import the DB layer so the tests can seed data using the same
// stubbed connection.
const dbMem = await import("../shared/db/memories.ts");

const baseUrl = "http://localhost";

function setupDb() {
  const t = createTestMemoryDb();
  holder.db = t.db;
  return () => { t.raw.close(); holder.db = null; };
}

// ─── handleMemories (GET list / search) ────────────────────────────────────

describe("handleMemories", () => {
  let teardown: () => void;
  beforeEach(() => { teardown = setupDb(); });
  afterEach(() => { teardown(); });

  test("empty DB returns empty list", async () => {
    const res = await api.handleMemories(new Request(`${baseUrl}/api/memories`));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.memories).toEqual([]);
  });

  test("lists all non-archived memories", async () => {
    await dbMem.createMemory({ type: "person", title: "Alice", body: "hi", aliases: ["a"] });
    await dbMem.createMemory({ type: "project", title: "Kent", body: "bye", sources: ["gmail"] });

    const res = await api.handleMemories(new Request(`${baseUrl}/api/memories`));
    const body = await res.json();
    expect(body.memories).toHaveLength(2);
    // parseMemory must convert sources/aliases to arrays and is_archived to boolean
    const alice = body.memories.find((m: any) => m.title === "Alice");
    expect(alice.aliases).toEqual(["a"]);
    expect(alice.sources).toEqual([]);
    expect(alice.is_archived).toBe(false);
  });

  test("excludes archived memories", async () => {
    const id = await dbMem.createMemory({ type: "topic", title: "Old", body: "b" });
    await dbMem.archiveMemory(id);
    await dbMem.createMemory({ type: "topic", title: "New", body: "b" });

    const res = await api.handleMemories(new Request(`${baseUrl}/api/memories`));
    const body = await res.json();
    expect(body.memories).toHaveLength(1);
    expect(body.memories[0].title).toBe("New");
  });

  test("filters by ?type=", async () => {
    await dbMem.createMemory({ type: "person", title: "Alice", body: "" });
    await dbMem.createMemory({ type: "project", title: "Kent", body: "" });

    const res = await api.handleMemories(new Request(`${baseUrl}/api/memories?type=person`));
    const body = await res.json();
    expect(body.memories).toHaveLength(1);
    expect(body.memories[0].title).toBe("Alice");
  });

  test("?q= runs search across title/body/alias", async () => {
    await dbMem.createMemory({ type: "topic", title: "SQLite", body: "embedded db" });
    await dbMem.createMemory({ type: "topic", title: "Rust", body: "systems lang" });

    const res = await api.handleMemories(new Request(`${baseUrl}/api/memories?q=embedded`));
    const body = await res.json();
    expect(body.memories).toHaveLength(1);
    expect(body.memories[0].title).toBe("SQLite");
  });
});

// ─── handleMemoryDetail ────────────────────────────────────────────────────

describe("handleMemoryDetail", () => {
  let teardown: () => void;
  beforeEach(() => { teardown = setupDb(); });
  afterEach(() => { teardown(); });

  test("returns 404 for an unknown id", async () => {
    const res = await api.handleMemoryDetail(new Request(`${baseUrl}/api/memories/ghost`));
    expect(res.status).toBe(404);
  });

  test("returns the memory with parsed fields", async () => {
    const id = await dbMem.createMemory({
      type: "person",
      title: "Alice",
      body: "# Alice",
      aliases: ["al"],
      sources: ["imessage"],
    });

    const res = await api.handleMemoryDetail(new Request(`${baseUrl}/api/memories/${id}`));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.memory.id).toBe(id);
    expect(body.memory.title).toBe("Alice");
    expect(body.memory.aliases).toEqual(["al"]);
    expect(body.memory.sources).toEqual(["imessage"]);
    expect(body.memory.is_archived).toBe(false);
  });

  test("includes outgoing and incoming links", async () => {
    const a = await dbMem.createMemory({ type: "person", title: "A", body: "" });
    const b = await dbMem.createMemory({ type: "project", title: "B", body: "" });
    const c = await dbMem.createMemory({ type: "topic", title: "C", body: "" });
    await dbMem.linkMemories(a, b, "works on");
    await dbMem.linkMemories(c, a, "mentions");

    const res = await api.handleMemoryDetail(new Request(`${baseUrl}/api/memories/${a}`));
    const body = await res.json();
    expect(body.links.outgoing).toHaveLength(1);
    expect(body.links.outgoing[0].title).toBe("B");
    expect(body.links.outgoing[0].link_label).toBe("works on");
    expect(body.links.incoming).toHaveLength(1);
    expect(body.links.incoming[0].title).toBe("C");
    expect(body.links.incoming[0].link_label).toBe("mentions");
  });

  test("includes a memoryIndex keyed by title and alias (lowercased)", async () => {
    const id = await dbMem.createMemory({
      type: "person", title: "Alice", body: "", aliases: ["AL", "Alicia"],
    });
    const res = await api.handleMemoryDetail(new Request(`${baseUrl}/api/memories/${id}`));
    const body = await res.json();
    expect(body.memoryIndex.alice).toBeDefined();
    expect(body.memoryIndex.alice.id).toBe(id);
    expect(body.memoryIndex.al).toBeDefined();
    expect(body.memoryIndex.alicia).toBeDefined();
  });
});

// ─── handleMemoryIndex ─────────────────────────────────────────────────────

describe("handleMemoryIndex", () => {
  let teardown: () => void;
  beforeEach(() => { teardown = setupDb(); });
  afterEach(() => { teardown(); });

  test("returns empty object when no memories", async () => {
    const res = await api.handleMemoryIndex(new Request(`${baseUrl}/api/memories/_index`));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.memoryIndex).toEqual({});
  });

  test("indexes by title and aliases", async () => {
    const id = await dbMem.createMemory({
      type: "person", title: "Bob", body: "", aliases: ["bobby"],
    });
    const res = await api.handleMemoryIndex(new Request(`${baseUrl}/api/memories/_index`));
    const body = await res.json();
    expect(body.memoryIndex.bob.id).toBe(id);
    expect(body.memoryIndex.bobby.id).toBe(id);
  });

  test("excludes archived memories from the index", async () => {
    const id = await dbMem.createMemory({ type: "topic", title: "Gone", body: "" });
    await dbMem.archiveMemory(id);
    const res = await api.handleMemoryIndex(new Request(`${baseUrl}/api/memories/_index`));
    const body = await res.json();
    expect(body.memoryIndex.gone).toBeUndefined();
  });
});

// ─── handleMemoryUpdate ────────────────────────────────────────────────────

describe("handleMemoryUpdate", () => {
  let teardown: () => void;
  beforeEach(() => { teardown = setupDb(); });
  afterEach(() => { teardown(); });

  test("returns 404 for URL that does not match", async () => {
    const req = new Request(`${baseUrl}/api/memories`, {
      method: "PATCH",
      body: JSON.stringify({ title: "x" }),
      headers: { "content-type": "application/json" },
    });
    const res = await api.handleMemoryUpdate(req);
    expect(res.status).toBe(404);
  });

  test("updates title/summary/body/type", async () => {
    const id = await dbMem.createMemory({ type: "topic", title: "Orig", body: "b" });
    const req = new Request(`${baseUrl}/api/memories/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ title: "New", summary: "s", body: "nb", type: "project" }),
      headers: { "content-type": "application/json" },
    });
    const res = await api.handleMemoryUpdate(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);

    const got = await dbMem.getMemory(id);
    expect(got!.title).toBe("New");
    expect(got!.summary).toBe("s");
    expect(got!.body).toBe("nb");
    expect(got!.type).toBe("project");
  });

  test("partial updates leave other fields alone", async () => {
    const id = await dbMem.createMemory({ type: "topic", title: "Orig", body: "orig", summary: "s0" });
    const req = new Request(`${baseUrl}/api/memories/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ title: "New" }),
      headers: { "content-type": "application/json" },
    });
    await api.handleMemoryUpdate(req);
    const got = await dbMem.getMemory(id);
    expect(got!.title).toBe("New");
    expect(got!.summary).toBe("s0");
    expect(got!.body).toBe("orig");
  });

  test("empty body is accepted (no fields to update)", async () => {
    const id = await dbMem.createMemory({ type: "topic", title: "A", body: "b" });
    const req = new Request(`${baseUrl}/api/memories/${id}`, {
      method: "PATCH",
      body: JSON.stringify({}),
      headers: { "content-type": "application/json" },
    });
    const res = await api.handleMemoryUpdate(req);
    expect(res.status).toBe(200);
  });
});

// ─── handleMemoryArchive ───────────────────────────────────────────────────

describe("handleMemoryArchive", () => {
  let teardown: () => void;
  beforeEach(() => { teardown = setupDb(); });
  afterEach(() => { teardown(); });

  test("returns 404 when path does not match", async () => {
    const req = new Request(`${baseUrl}/api/memories/abc`, { method: "POST" });
    const res = await api.handleMemoryArchive(req);
    expect(res.status).toBe(404);
  });

  test("archives a memory and returns ok", async () => {
    const id = await dbMem.createMemory({ type: "topic", title: "t", body: "b" });
    const req = new Request(`${baseUrl}/api/memories/${id}/archive`, { method: "POST" });
    const res = await api.handleMemoryArchive(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);

    const got = await dbMem.getMemory(id);
    expect(got!.is_archived).toBe(1);
  });

  test("archiving an unknown id still returns ok (silent no-op)", async () => {
    const req = new Request(`${baseUrl}/api/memories/ghost/archive`, { method: "POST" });
    const res = await api.handleMemoryArchive(req);
    expect(res.status).toBe(200);
  });
});
