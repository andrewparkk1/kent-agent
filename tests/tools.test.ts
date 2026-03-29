import { test, expect, describe } from "bun:test";

/**
 * Tests for agent tool definitions and logic.
 * We test tool metadata (names, descriptions, parameters) and
 * the local-only guard logic for filesystem tools.
 */

describe("Tool exports", () => {
  test("memoryTools has 6 tools", async () => {
    const { memoryTools } = await import("../agent/tools.ts");
    expect(memoryTools).toHaveLength(6);
  });

  test("filesystemTools has 5 tools", async () => {
    const { filesystemTools } = await import("../agent/tools.ts");
    expect(filesystemTools).toHaveLength(5);
  });

  test("allTools combines memory + filesystem tools", async () => {
    const { allTools, memoryTools, filesystemTools } = await import("../agent/tools.ts");
    expect(allTools).toHaveLength(memoryTools.length + filesystemTools.length);
    expect(allTools).toHaveLength(11);
  });
});

describe("Tool names", () => {
  test("memory tools have expected names", async () => {
    const { memoryTools } = await import("../agent/tools.ts");
    const names = memoryTools.map((t: any) => t.name);

    expect(names).toContain("search_semantic");
    expect(names).toContain("search_exact");
    expect(names).toContain("get_recent_items");
    expect(names).toContain("browse_items");
    expect(names).toContain("get_item_detail");
    expect(names).toContain("get_source_stats");
  });

  test("filesystem tools have expected names", async () => {
    const { filesystemTools } = await import("../agent/tools.ts");
    const names = filesystemTools.map((t: any) => t.name);

    expect(names).toContain("read_file");
    expect(names).toContain("list_directory");
    expect(names).toContain("search_files");
    expect(names).toContain("write_file");
    expect(names).toContain("run_command");
  });
});

describe("Tool metadata", () => {
  test("all tools have name, description, and parameters", async () => {
    const { allTools } = await import("../agent/tools.ts");

    for (const tool of allTools as any[]) {
      expect(tool.name).toBeTruthy();
      expect(typeof tool.name).toBe("string");
      expect(tool.description).toBeTruthy();
      expect(typeof tool.description).toBe("string");
      expect(tool.parameters).toBeTruthy();
    }
  });

  test("all tools have label for UI display", async () => {
    const { allTools } = await import("../agent/tools.ts");

    for (const tool of allTools as any[]) {
      expect(tool.label).toBeTruthy();
      expect(typeof tool.label).toBe("string");
    }
  });

  test("all tools have execute function", async () => {
    const { allTools } = await import("../agent/tools.ts");

    for (const tool of allTools as any[]) {
      expect(typeof tool.execute).toBe("function");
    }
  });

  test("tool names are unique", async () => {
    const { allTools } = await import("../agent/tools.ts");
    const names = (allTools as any[]).map((t) => t.name);
    const uniqueNames = new Set(names);
    expect(uniqueNames.size).toBe(names.length);
  });
});

describe("Filesystem tool local-only guard", () => {
  // When RUNNER !== "local", filesystem tools should return an error message

  test("read_file returns error in cloud mode", async () => {
    // The tools module reads RUNNER from process.env at import time
    // Default RUNNER is "cloud" so filesystem tools should be gated
    const { filesystemTools } = await import("../agent/tools.ts");
    const readFile = (filesystemTools as any[]).find((t) => t.name === "read_file");

    const result = await readFile.execute("test-id", { path: "/tmp/test.txt" });

    expect(result.content).toBeDefined();
    expect(result.content[0].text).toContain("local runner mode");
  });

  test("list_directory returns error in cloud mode", async () => {
    const { filesystemTools } = await import("../agent/tools.ts");
    const listDir = (filesystemTools as any[]).find((t) => t.name === "list_directory");

    const result = await listDir.execute("test-id", { path: "/tmp" });
    expect(result.content[0].text).toContain("local runner mode");
  });

  test("write_file returns error in cloud mode", async () => {
    const { filesystemTools } = await import("../agent/tools.ts");
    const writeFile = (filesystemTools as any[]).find((t) => t.name === "write_file");

    const result = await writeFile.execute("test-id", { path: "test.txt", content: "hello" });
    expect(result.content[0].text).toContain("local runner mode");
  });

  test("run_command returns error in cloud mode", async () => {
    const { filesystemTools } = await import("../agent/tools.ts");
    const runCmd = (filesystemTools as any[]).find((t) => t.name === "run_command");

    const result = await runCmd.execute("test-id", { command: "echo hello" });
    expect(result.content[0].text).toContain("local runner mode");
  });

  test("search_files returns error in cloud mode", async () => {
    const { filesystemTools } = await import("../agent/tools.ts");
    const searchFiles = (filesystemTools as any[]).find((t) => t.name === "search_files");

    const result = await searchFiles.execute("test-id", { pattern: "test" });
    expect(result.content[0].text).toContain("local runner mode");
  });
});

describe("Memory tool error handling", () => {
  // Memory tools call Convex. Without a valid URL they should fail gracefully.

  test("search_semantic handles missing Convex URL", async () => {
    const { memoryTools } = await import("../agent/tools.ts");
    const searchSemantic = (memoryTools as any[]).find((t) => t.name === "search_semantic");

    const result = await searchSemantic.execute("test-id", { query: "test" });

    // Should return an error result, not throw
    expect(result.content).toBeDefined();
    expect(result.content[0].type).toBe("text");
    expect(result.content[0].text).toContain("failed");
  });

  test("search_exact handles missing Convex URL", async () => {
    const { memoryTools } = await import("../agent/tools.ts");
    const searchExact = (memoryTools as any[]).find((t) => t.name === "search_exact");

    const result = await searchExact.execute("test-id", { query: "test" });
    expect(result.content[0].text).toContain("failed");
  });

  test("get_recent_items handles missing Convex URL", async () => {
    const { memoryTools } = await import("../agent/tools.ts");
    const getRecent = (memoryTools as any[]).find((t) => t.name === "get_recent_items");

    const result = await getRecent.execute("test-id", {});
    expect(result.content[0].text).toContain("failed");
  });

  test("get_source_stats handles missing Convex URL", async () => {
    const { memoryTools } = await import("../agent/tools.ts");
    const getStats = (memoryTools as any[]).find((t) => t.name === "get_source_stats");

    const result = await getStats.execute("test-id", {});
    expect(result.content[0].text).toContain("failed");
  });

  test("get_item_detail handles missing Convex URL", async () => {
    const { memoryTools } = await import("../agent/tools.ts");
    const getDetail = (memoryTools as any[]).find((t) => t.name === "get_item_detail");

    const result = await getDetail.execute("test-id", { id: "fake-id" });
    expect(result.content[0].text).toContain("failed");
  });

  test("browse_items handles missing Convex URL", async () => {
    const { memoryTools } = await import("../agent/tools.ts");
    const browse = (memoryTools as any[]).find((t) => t.name === "browse_items");

    const result = await browse.execute("test-id", {});
    expect(result.content[0].text).toContain("failed");
  });
});
