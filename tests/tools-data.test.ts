import "./_tools-test-setup.ts"; // must precede helpers.ts import
import { test, expect, describe, beforeEach, mock } from "bun:test";

// ─── In-memory stubs for @shared/db.ts ──────────────────────────────────────
let items: Array<{ id: number; source: string; content: string; created_at: number; metadata?: any }> = [];
let threads: Array<{ id: string; title: string; type: string; status: string; created_at: number }> = [];
let messages: Record<string, Array<{ role: string; content: string; metadata?: string | null }>> = {};
let throwOn: string | null = null;

function searchItems(q: string, limit = 50, source?: string) {
  if (throwOn === "searchItems") { throwOn = null; throw new Error("boom"); }
  return items
    .filter((i) => i.content.toLowerCase().includes(q.toLowerCase()) && (!source || i.source === source))
    .slice(0, limit);
}
async function getItemsBySource(source: string, limit = 50) {
  if (throwOn === "getItemsBySource") { throwOn = null; throw new Error("boom"); }
  return items.filter((i) => i.source === source).sort((a, b) => b.created_at - a.created_at).slice(0, limit);
}
async function getItemCount() {
  if (throwOn === "getItemCount") { throwOn = null; throw new Error("boom"); }
  const counts: Record<string, number> = {};
  for (const i of items) counts[i.source] = (counts[i.source] ?? 0) + 1;
  return counts;
}
async function getRecentThreads(limit = 10, type?: string) {
  if (throwOn === "getRecentThreads") { throwOn = null; throw new Error("boom"); }
  return threads.filter((t) => !type || t.type === type).slice(0, limit);
}
async function getMessages(threadId: string, limit = 200) {
  if (throwOn === "getMessages") { throwOn = null; throw new Error("boom"); }
  return (messages[threadId] ?? []).slice(0, limit);
}

// Include noop stubs for exports used by sibling tool modules (workflow, memory)
// so re-imports after other tests that also mock @shared/db.ts don't break.
const _noop = async () => {};
const _noopArr = async () => [];
mock.module("@shared/db.ts", () => ({
  searchItems, getItemsBySource, getItemCount, getRecentThreads, getMessages,
  // workflow.ts
  createWorkflow: async () => "wf",
  listWorkflows: _noopArr,
  deleteWorkflow: async () => false,
  updateWorkflow: _noop,
  getWorkflow: async () => null,
  // memory.ts
  createMemory: async () => "m",
  updateMemory: _noop,
  archiveMemory: _noop,
  listMemories: _noopArr,
  searchMemories: _noopArr,
  linkMemories: _noop,
  unlinkMemories: _noop,
}));

const { searchData, getRecent, getStats, getThreads, getThreadMessages, dataTools } =
  await import("@agent/tools/data.ts");

function reset() {
  items = [];
  threads = [];
  messages = {};
  throwOn = null;
}

describe("tools/data — schemas", () => {
  test("dataTools exposes 5 tools with valid schemas", () => {
    expect(dataTools.length).toBe(5);
    for (const t of dataTools) {
      expect(typeof t.name).toBe("string");
      expect(typeof t.description).toBe("string");
      expect(t.description.length).toBeGreaterThan(0);
      expect((t.parameters as any).type).toBe("object");
      expect(typeof t.execute).toBe("function");
    }
  });

  test("tool names are unique and expected", () => {
    const names = dataTools.map((t) => t.name);
    expect(names).toEqual(["search_memory", "get_recent_items", "get_source_stats", "get_recent_threads", "get_thread_messages"]);
    expect(new Set(names).size).toBe(names.length);
  });
});

describe("tools/data — search_memory", () => {
  beforeEach(() => {
    reset();
    items = [
      { id: 1, source: "imessage", content: "Hello Alice", created_at: 1000 },
      { id: 2, source: "gmail", content: "Meeting reminder", created_at: 2000 },
      { id: 3, source: "imessage", content: "Hello Bob", created_at: 3000 },
    ];
  });

  test("returns JSON of matching items", async () => {
    const res = await searchData.execute("id", { query: "Hello" });
    const parsed = JSON.parse(res.content[0]!.text);
    expect(parsed.length).toBe(2);
  });

  test("honors source filter", async () => {
    const res = await searchData.execute("id", { query: "Hello", source: "imessage" });
    const parsed = JSON.parse(res.content[0]!.text);
    expect(parsed.every((p: any) => p.source === "imessage")).toBe(true);
  });

  test("honors custom limit", async () => {
    const res = await searchData.execute("id", { query: "Hello", limit: 1 });
    const parsed = JSON.parse(res.content[0]!.text);
    expect(parsed.length).toBe(1);
  });

  test("empty results serialize as empty array", async () => {
    const res = await searchData.execute("id", { query: "xyznope" });
    expect(JSON.parse(res.content[0]!.text)).toEqual([]);
  });

  test("db errors surface as Error", async () => {
    throwOn = "searchItems";
    await expect(searchData.execute("id", { query: "x" })).rejects.toThrow(/search_memory failed/);
  });
});

describe("tools/data — get_recent_items", () => {
  beforeEach(() => {
    reset();
    items = [
      { id: 1, source: "imessage", content: "m1", created_at: 1000 },
      { id: 2, source: "gmail", content: "e1", created_at: 3000 },
      { id: 3, source: "imessage", content: "m2", created_at: 2000 },
    ];
  });

  test("returns only the requested source when specified", async () => {
    const res = await getRecent.execute("id", { source: "imessage" });
    const parsed = JSON.parse(res.content[0]!.text);
    expect(parsed.length).toBe(2);
    expect(parsed.every((i: any) => i.source === "imessage")).toBe(true);
  });

  test("merges all sources when source omitted, sorted DESC by created_at", async () => {
    const res = await getRecent.execute("id", {});
    const parsed = JSON.parse(res.content[0]!.text);
    expect(parsed.length).toBe(3);
    expect(parsed[0].created_at).toBe(3000);
    expect(parsed[2].created_at).toBe(1000);
  });

  test("respects limit across merged sources", async () => {
    const res = await getRecent.execute("id", { limit: 1 });
    expect(JSON.parse(res.content[0]!.text).length).toBe(1);
  });

  test("surfaces db errors", async () => {
    throwOn = "getItemCount";
    await expect(getRecent.execute("id", {})).rejects.toThrow(/get_recent_items failed/);
  });
});

describe("tools/data — get_source_stats", () => {
  beforeEach(reset);

  test("returns counts per source as JSON", async () => {
    items = [
      { id: 1, source: "a", content: "x", created_at: 1 },
      { id: 2, source: "a", content: "y", created_at: 2 },
      { id: 3, source: "b", content: "z", created_at: 3 },
    ];
    const res = await getStats.execute("id", {});
    expect(JSON.parse(res.content[0]!.text)).toEqual({ a: 2, b: 1 });
  });

  test("empty db → empty object", async () => {
    const res = await getStats.execute("id", {});
    expect(JSON.parse(res.content[0]!.text)).toEqual({});
  });

  test("errors surface", async () => {
    throwOn = "getItemCount";
    await expect(getStats.execute("id", {})).rejects.toThrow(/get_source_stats failed/);
  });
});

describe("tools/data — get_recent_threads", () => {
  beforeEach(() => {
    reset();
    threads = [
      { id: "t1", title: "Chat 1", type: "chat", status: "done", created_at: 1000 },
      { id: "t2", title: "WF run", type: "workflow", status: "running", created_at: 2000 },
    ];
  });

  test("returns threads with ISO timestamps", async () => {
    const res = await getThreads.execute("id", {});
    const parsed = JSON.parse(res.content[0]!.text);
    expect(parsed.length).toBe(2);
    expect(parsed[0].created).toBe(new Date(1000 * 1000).toISOString());
    expect(parsed[0].id).toBe("t1");
  });

  test("filters by type", async () => {
    const res = await getThreads.execute("id", { type: "workflow" });
    const parsed = JSON.parse(res.content[0]!.text);
    expect(parsed.length).toBe(1);
    expect(parsed[0].type).toBe("workflow");
  });

  test("empty → empty JSON array", async () => {
    threads = [];
    const res = await getThreads.execute("id", {});
    expect(JSON.parse(res.content[0]!.text)).toEqual([]);
  });

  test("errors surface", async () => {
    throwOn = "getRecentThreads";
    await expect(getThreads.execute("id", {})).rejects.toThrow(/get_recent_threads failed/);
  });
});

describe("tools/data — get_thread_messages", () => {
  beforeEach(() => {
    reset();
    messages = {
      "t1": [
        { role: "user", content: "hi" },
        { role: "assistant", content: "hello", metadata: JSON.stringify({ model: "claude" }) },
      ],
    };
  });

  test("returns messages with parsed metadata", async () => {
    const res = await getThreadMessages.execute("id", { thread_id: "t1" });
    const parsed = JSON.parse(res.content[0]!.text);
    expect(parsed.length).toBe(2);
    expect(parsed[0]).toEqual({ role: "user", content: "hi" });
    expect(parsed[1].metadata).toEqual({ model: "claude" });
  });

  test("unknown thread → empty array", async () => {
    const res = await getThreadMessages.execute("id", { thread_id: "nope" });
    expect(JSON.parse(res.content[0]!.text)).toEqual([]);
  });

  test("errors surface", async () => {
    throwOn = "getMessages";
    await expect(getThreadMessages.execute("id", { thread_id: "t1" })).rejects.toThrow(/get_thread_messages failed/);
  });
});
