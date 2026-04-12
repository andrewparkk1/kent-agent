import "./_tools-test-setup.ts"; // must be first — mocks node:os before skills.ts loads
import { test, expect, describe, mock } from "bun:test";

// Stub @shared/db.ts with no-op functions so all tool modules can load
// without touching the real user database.
const noop = async () => {};
const noopArr = async () => [];
const noopObj = async () => ({});
mock.module("@shared/db.ts", () => ({
  // data.ts
  searchItems: () => [],
  getItemsBySource: noopArr,
  getItemCount: noopObj,
  getRecentThreads: noopArr,
  getMessages: noopArr,
  // workflow.ts
  createWorkflow: async () => "wf-1",
  listWorkflows: noopArr,
  deleteWorkflow: async () => false,
  updateWorkflow: noop,
  getWorkflow: async () => null,
  // memory.ts
  createMemory: async () => "m-1",
  updateMemory: noop,
  archiveMemory: noop,
  listMemories: noopArr,
  searchMemories: noopArr,
  linkMemories: noop,
  unlinkMemories: noop,
}));

const mod = await import("@agent/tools/index.ts");
const { allTools, dataTools, workflowTools, filesystemTools, skillTools, memoryTools } = mod;

describe("tools/index — re-exports", () => {
  test("all tool groups are exported as arrays", () => {
    expect(Array.isArray(dataTools)).toBe(true);
    expect(Array.isArray(workflowTools)).toBe(true);
    expect(Array.isArray(filesystemTools)).toBe(true);
    expect(Array.isArray(skillTools)).toBe(true);
    expect(Array.isArray(memoryTools)).toBe(true);
  });

  test("allTools is the concatenation of every group", () => {
    const expectedLength =
      dataTools.length + memoryTools.length + workflowTools.length +
      filesystemTools.length + skillTools.length;
    expect(allTools.length).toBe(expectedLength);
    expect(allTools.length).toBeGreaterThan(0);
  });
});

describe("tools/index — schema validity", () => {
  test("every tool has name, description, parameters, execute", () => {
    for (const t of allTools) {
      expect(typeof t.name).toBe("string");
      expect(t.name.length).toBeGreaterThan(0);
      expect(typeof t.description).toBe("string");
      expect(t.description.length).toBeGreaterThan(0);
      expect(t.parameters).toBeDefined();
      expect((t.parameters as any).type).toBe("object");
      expect(typeof t.execute).toBe("function");
    }
  });

  test("no duplicate tool names across all groups", () => {
    const names = allTools.map((t) => t.name);
    const unique = new Set(names);
    if (unique.size !== names.length) {
      const dupes = names.filter((n, i) => names.indexOf(n) !== i);
      throw new Error(`Duplicate tool names found: ${[...new Set(dupes)].join(", ")}`);
    }
    expect(unique.size).toBe(names.length);
  });

  test("all tool names use snake_case (lowercase + underscores)", () => {
    for (const t of allTools) {
      expect(t.name).toMatch(/^[a-z][a-z0-9_]*$/);
    }
  });

  test("every tool parameters is a typebox Object schema", () => {
    for (const t of allTools) {
      const p: any = t.parameters;
      expect(p.type).toBe("object");
      expect(p.properties === undefined || typeof p.properties === "object").toBe(true);
    }
  });
});
