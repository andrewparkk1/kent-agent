import "./_tools-test-setup.ts"; // must precede helpers.ts import
import { test, expect, describe, beforeEach, mock } from "bun:test";

// ─── In-memory workflow store stubs for @shared/db.ts ────────────────────────
type WF = {
  id: string;
  name: string;
  description?: string;
  prompt: string;
  cron_schedule?: string;
  type?: string;
  source?: string;
  enabled?: number;
  last_run_at?: number | null;
};

let store: Map<string, WF> = new Map();
let nextId = 1;
let throwOnNextCall: string | null = null;

async function createWorkflow(params: any): Promise<string> {
  if (throwOnNextCall === "createWorkflow") { throwOnNextCall = null; throw new Error("db down"); }
  const id = `wf-${nextId++}`;
  store.set(id, {
    id, name: params.name, description: params.description, prompt: params.prompt,
    cron_schedule: params.cron_schedule, type: params.type ?? "cron",
    source: params.source ?? "user", enabled: 1, last_run_at: null,
  });
  return id;
}
async function listWorkflows(): Promise<WF[]> {
  if (throwOnNextCall === "listWorkflows") { throwOnNextCall = null; throw new Error("db down"); }
  return [...store.values()];
}
async function deleteWorkflow(name: string): Promise<boolean> {
  if (throwOnNextCall === "deleteWorkflow") { throwOnNextCall = null; throw new Error("db down"); }
  for (const [id, wf] of store) {
    if (wf.name === name) { store.delete(id); return true; }
  }
  return false;
}
async function getWorkflow(name: string): Promise<WF | null> {
  if (throwOnNextCall === "getWorkflow") { throwOnNextCall = null; throw new Error("db down"); }
  for (const wf of store.values()) if (wf.name === name) return wf;
  return null;
}
async function updateWorkflow(id: string, updates: Partial<WF>): Promise<void> {
  if (throwOnNextCall === "updateWorkflow") { throwOnNextCall = null; throw new Error("db down"); }
  const wf = store.get(id);
  if (!wf) throw new Error("not found");
  store.set(id, { ...wf, ...updates });
}

const _noop = async () => {};
const _noopArr = async () => [];
mock.module("@shared/db.ts", () => ({
  createWorkflow, listWorkflows, deleteWorkflow, getWorkflow, updateWorkflow,
  // data.ts
  searchItems: () => [],
  getItemsBySource: _noopArr,
  getItemCount: async () => ({}),
  getRecentThreads: _noopArr,
  getMessages: _noopArr,
  // memory.ts
  createMemory: async () => "m",
  updateMemory: _noop,
  archiveMemory: _noop,
  listMemories: _noopArr,
  searchMemories: _noopArr,
  linkMemories: _noop,
  unlinkMemories: _noop,
}));

// Import after mocking
const { wfCreate, wfList, wfDelete, wfUpdate, workflowTools } = await import("@agent/tools/workflow.ts");

function resetStore() {
  store = new Map();
  nextId = 1;
  throwOnNextCall = null;
}

describe("tools/workflow — schemas", () => {
  test("workflowTools array has 4 tools with valid schemas", () => {
    expect(workflowTools.length).toBe(4);
    for (const t of workflowTools) {
      expect(typeof t.name).toBe("string");
      expect(t.name.length).toBeGreaterThan(0);
      expect(typeof t.description).toBe("string");
      expect(t.parameters).toBeDefined();
      expect((t.parameters as any).type).toBe("object");
      expect(typeof t.execute).toBe("function");
    }
  });

  test("tool names are unique", () => {
    const names = workflowTools.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
  });

  test("expected tool names present", () => {
    const names = workflowTools.map((t) => t.name);
    expect(names).toEqual(["create_workflow", "list_workflows", "delete_workflow", "update_workflow"]);
  });
});

describe("tools/workflow — create_workflow", () => {
  beforeEach(resetStore);

  test("creates with scheduled message including cron", async () => {
    const res = await wfCreate.execute("id1", { name: "daily", prompt: "do thing", cron_schedule: "0 9 * * *" });
    expect(res.content[0]!.text).toContain('Workflow "daily" created');
    expect(res.content[0]!.text).toContain("Scheduled: 0 9 * * *");
    expect(store.size).toBe(1);
  });

  test("creates manual-only when cron omitted", async () => {
    const res = await wfCreate.execute("id1", { name: "manual", prompt: "p" });
    expect(res.content[0]!.text).toContain("Manual trigger only");
  });

  test("propagates db errors as thrown Error", async () => {
    throwOnNextCall = "createWorkflow";
    await expect(wfCreate.execute("id1", { name: "x", prompt: "p" })).rejects.toThrow(/Failed to create workflow/);
  });
});

describe("tools/workflow — list_workflows", () => {
  beforeEach(resetStore);

  test("returns friendly message when empty", async () => {
    const res = await wfList.execute("id", {});
    expect(res.content[0]!.text).toBe("No workflows configured yet.");
  });

  test("lists workflows as JSON", async () => {
    await createWorkflow({ name: "w1", prompt: "p1", cron_schedule: "* * * * *" });
    await createWorkflow({ name: "w2", prompt: "p2" });
    const res = await wfList.execute("id", {});
    const parsed = JSON.parse(res.content[0]!.text);
    expect(parsed.length).toBe(2);
    expect(parsed[0].name).toBe("w1");
    expect(parsed[0].cron).toBe("* * * * *");
    expect(parsed[1].cron).toBe("manual");
    expect(parsed[0].lastRun).toBe("never");
    expect(parsed[0].enabled).toBe(true);
  });

  test("converts last_run_at epoch to ISO", async () => {
    await createWorkflow({ name: "w1", prompt: "p" });
    const wf = [...store.values()][0]!;
    wf.last_run_at = 1700000000;
    const res = await wfList.execute("id", {});
    const parsed = JSON.parse(res.content[0]!.text);
    expect(parsed[0].lastRun).toBe(new Date(1700000000 * 1000).toISOString());
  });

  test("propagates db errors", async () => {
    throwOnNextCall = "listWorkflows";
    await expect(wfList.execute("id", {})).rejects.toThrow(/Failed to list workflows/);
  });
});

describe("tools/workflow — delete_workflow", () => {
  beforeEach(resetStore);

  test("deletes existing workflow", async () => {
    await createWorkflow({ name: "doomed", prompt: "p" });
    const res = await wfDelete.execute("id", { name: "doomed" });
    expect(res.content[0]!.text).toContain('Workflow "doomed" deleted');
    expect(store.size).toBe(0);
  });

  test("returns not-found error when missing", async () => {
    await expect(wfDelete.execute("id", { name: "ghost" })).rejects.toThrow(/not found/);
  });

  test("propagates db errors", async () => {
    throwOnNextCall = "deleteWorkflow";
    await expect(wfDelete.execute("id", { name: "x" })).rejects.toThrow(/Failed to delete workflow/);
  });
});

describe("tools/workflow — update_workflow", () => {
  beforeEach(resetStore);

  test("updates an existing workflow", async () => {
    await createWorkflow({ name: "w1", prompt: "old" });
    const res = await wfUpdate.execute("id", { name: "w1", updates: { prompt: "new", enabled: 0 } });
    expect(res.content[0]!.text).toContain('Workflow "w1" updated');
    expect(res.content[0]!.text).toContain("prompt");
    expect(res.content[0]!.text).toContain("enabled");
    const wf = [...store.values()][0]!;
    expect(wf.prompt).toBe("new");
    expect(wf.enabled).toBe(0);
  });

  test("errors when workflow not found", async () => {
    await expect(wfUpdate.execute("id", { name: "ghost", updates: { prompt: "x" } }))
      .rejects.toThrow(/not found/);
  });

  test("propagates db errors on getWorkflow", async () => {
    throwOnNextCall = "getWorkflow";
    await expect(wfUpdate.execute("id", { name: "x", updates: {} })).rejects.toThrow(/Failed to update workflow/);
  });
});
