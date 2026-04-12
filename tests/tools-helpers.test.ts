import "./_tools-test-setup.ts"; // must precede helpers.ts import
import { test, expect, describe } from "bun:test";
import { ok, err, json, OUTPUT_DIR } from "@agent/tools/helpers.ts";

describe("tools/helpers", () => {
  test("ok() wraps a string in AgentToolResult shape", () => {
    const result = ok("hello");
    expect(result.content).toEqual([{ type: "text", text: "hello" }]);
    expect(result.details).toBeUndefined();
  });

  test("ok() handles empty string", () => {
    const result = ok("");
    expect(result.content[0]!.text).toBe("");
  });

  test("json() serializes objects with indent=2", () => {
    const result = json({ a: 1, b: [2, 3] });
    expect(result.content[0]!.text).toBe('{\n  "a": 1,\n  "b": [\n    2,\n    3\n  ]\n}');
  });

  test("json() handles null", () => {
    const result = json(null);
    expect(result.content[0]!.text).toBe("null");
  });

  test("json() handles empty array", () => {
    const result = json([]);
    expect(result.content[0]!.text).toBe("[]");
  });

  test("err() throws Error with the given message", () => {
    expect(() => err("boom")).toThrow("boom");
    expect(() => err("boom")).toThrow(Error);
  });

  test("OUTPUT_DIR is a non-empty string", () => {
    expect(typeof OUTPUT_DIR).toBe("string");
    expect(OUTPUT_DIR.length).toBeGreaterThan(0);
  });
});
