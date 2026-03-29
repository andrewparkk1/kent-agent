import { test, expect, describe } from "bun:test";
import { memoryTools, filesystemTools, allTools } from "@agent/tools.ts";

describe("Agent tools", () => {
  describe("tool registry", () => {
    test("memoryTools has 6 tools", () => {
      expect(memoryTools.length).toBe(6);
    });

    test("filesystemTools has 5 tools", () => {
      expect(filesystemTools.length).toBe(5);
    });

    test("allTools combines memory and filesystem tools", () => {
      expect(allTools.length).toBe(11);
    });

    test("all tools have unique names", () => {
      const names = allTools.map((t: any) => t.name);
      const uniqueNames = new Set(names);
      expect(uniqueNames.size).toBe(names.length);
    });
  });

  describe("memory tools", () => {
    const memoryToolNames = [
      "search_semantic",
      "search_exact",
      "get_recent_items",
      "browse_items",
      "get_item_detail",
      "get_source_stats",
    ];

    for (const name of memoryToolNames) {
      test(`${name} tool exists`, () => {
        const tool = memoryTools.find((t: any) => t.name === name);
        expect(tool).toBeDefined();
      });

      test(`${name} has description`, () => {
        const tool = memoryTools.find((t: any) => t.name === name) as any;
        expect(tool.description).toBeTruthy();
        expect(typeof tool.description).toBe("string");
      });

      test(`${name} has parameters schema`, () => {
        const tool = memoryTools.find((t: any) => t.name === name) as any;
        expect(tool.parameters).toBeDefined();
      });

      test(`${name} has execute function`, () => {
        const tool = memoryTools.find((t: any) => t.name === name) as any;
        expect(typeof tool.execute).toBe("function");
      });

      test(`${name} has label`, () => {
        const tool = memoryTools.find((t: any) => t.name === name) as any;
        expect(tool.label).toBeTruthy();
      });
    }
  });

  describe("filesystem tools", () => {
    const fsToolNames = [
      "read_file",
      "list_directory",
      "search_files",
      "write_file",
      "run_command",
    ];

    for (const name of fsToolNames) {
      test(`${name} tool exists`, () => {
        const tool = filesystemTools.find((t: any) => t.name === name);
        expect(tool).toBeDefined();
      });

      test(`${name} has description`, () => {
        const tool = filesystemTools.find((t: any) => t.name === name) as any;
        expect(tool.description).toBeTruthy();
      });

      test(`${name} has execute function`, () => {
        const tool = filesystemTools.find((t: any) => t.name === name) as any;
        expect(typeof tool.execute).toBe("function");
      });
    }

    test("filesystem tools mention 'Local runner only' in descriptions", () => {
      for (const name of fsToolNames) {
        const tool = filesystemTools.find((t: any) => t.name === name) as any;
        expect(
          tool.description.toLowerCase().includes("local") ||
            tool.description.toLowerCase().includes("runner"),
        ).toBe(true);
      }
    });
  });

  describe("filesystem tools block in cloud mode", () => {
    // Tools check RUNNER env var which defaults to "cloud"
    // When RUNNER !== "local", they should return an error message

    test("read_file returns error in cloud mode", async () => {
      const tool = filesystemTools.find(
        (t: any) => t.name === "read_file",
      ) as any;
      const result = await tool.execute("test-id", {
        path: "/tmp/test.txt",
      });
      expect(result.content[0].text).toContain("local runner");
    });

    test("list_directory returns error in cloud mode", async () => {
      const tool = filesystemTools.find(
        (t: any) => t.name === "list_directory",
      ) as any;
      const result = await tool.execute("test-id", { path: "/tmp" });
      expect(result.content[0].text).toContain("local runner");
    });

    test("search_files returns error in cloud mode", async () => {
      const tool = filesystemTools.find(
        (t: any) => t.name === "search_files",
      ) as any;
      const result = await tool.execute("test-id", { pattern: "test" });
      expect(result.content[0].text).toContain("local runner");
    });

    test("write_file returns error in cloud mode", async () => {
      const tool = filesystemTools.find(
        (t: any) => t.name === "write_file",
      ) as any;
      const result = await tool.execute("test-id", {
        path: "test.txt",
        content: "hello",
      });
      expect(result.content[0].text).toContain("local runner");
    });

    test("run_command returns error in cloud mode", async () => {
      const tool = filesystemTools.find(
        (t: any) => t.name === "run_command",
      ) as any;
      const result = await tool.execute("test-id", { command: "echo hi" });
      expect(result.content[0].text).toContain("local runner");
    });
  });

  describe("memory tool schemas", () => {
    test("search_semantic requires query parameter", () => {
      const tool = memoryTools.find(
        (t: any) => t.name === "search_semantic",
      ) as any;
      expect(tool.parameters.properties.query).toBeDefined();
      expect(tool.parameters.required).toContain("query");
    });

    test("search_exact requires query parameter", () => {
      const tool = memoryTools.find(
        (t: any) => t.name === "search_exact",
      ) as any;
      expect(tool.parameters.properties.query).toBeDefined();
      expect(tool.parameters.required).toContain("query");
    });

    test("browse_items has optional source, sender, date filters", () => {
      const tool = memoryTools.find(
        (t: any) => t.name === "browse_items",
      ) as any;
      const props = tool.parameters.properties;
      expect(props.source).toBeDefined();
      expect(props.sender).toBeDefined();
      expect(props.after).toBeDefined();
      expect(props.before).toBeDefined();
      expect(props.cursor).toBeDefined();
    });

    test("get_item_detail requires id parameter", () => {
      const tool = memoryTools.find(
        (t: any) => t.name === "get_item_detail",
      ) as any;
      expect(tool.parameters.properties.id).toBeDefined();
      expect(tool.parameters.required).toContain("id");
    });

    test("get_source_stats has no required parameters", () => {
      const tool = memoryTools.find(
        (t: any) => t.name === "get_source_stats",
      ) as any;
      const required = tool.parameters.required || [];
      expect(required.length).toBe(0);
    });
  });
});
