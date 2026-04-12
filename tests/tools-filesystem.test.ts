import { FAKE_OUTPUT_DIR as OUTPUT_DIR_FOR_TEST } from "./_tools-test-setup.ts";
import { test, expect, describe, beforeEach, afterEach, afterAll } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const { fsRead, fsListDir, fsSearch, fsWrite, fsRunCommand, filesystemTools } =
  await import("@agent/tools/filesystem.ts");

let scratch: string;

beforeEach(() => {
  scratch = mkdtempSync(join(tmpdir(), "kent-fs-"));
});
afterEach(() => {
  try { rmSync(scratch, { recursive: true, force: true }); } catch {}
});

describe("tools/filesystem — schemas", () => {
  test("filesystemTools has 5 tools with valid schemas", () => {
    expect(filesystemTools.length).toBe(5);
    for (const t of filesystemTools) {
      expect(typeof t.name).toBe("string");
      expect(typeof t.description).toBe("string");
      expect(t.description.length).toBeGreaterThan(0);
      expect((t.parameters as any).type).toBe("object");
      expect(typeof t.execute).toBe("function");
    }
  });

  test("tool names are unique and expected", () => {
    const names = filesystemTools.map((t) => t.name);
    expect(names).toEqual(["read_file", "list_directory", "search_files", "write_file", "run_command"]);
    expect(new Set(names).size).toBe(names.length);
  });
});

describe("tools/filesystem — read_file", () => {
  test("reads an existing file", async () => {
    const p = join(scratch, "a.txt");
    writeFileSync(p, "hello world");
    const res = await fsRead.execute("id", { path: p });
    expect(res.content[0]!.text).toBe("hello world");
  });

  test("reads empty file as empty string", async () => {
    const p = join(scratch, "empty.txt");
    writeFileSync(p, "");
    const res = await fsRead.execute("id", { path: p });
    expect(res.content[0]!.text).toBe("");
  });

  test("missing file throws with path in error", async () => {
    const p = join(scratch, "nope.txt");
    await expect(fsRead.execute("id", { path: p })).rejects.toThrow(/Failed to read/);
  });
});

describe("tools/filesystem — list_directory", () => {
  test("lists files and subdirectories with type prefix", async () => {
    writeFileSync(join(scratch, "file.txt"), "x");
    mkdirSync(join(scratch, "sub"));
    const res = await fsListDir.execute("id", { path: scratch });
    const lines = res.content[0]!.text.split("\n").sort();
    expect(lines).toEqual(["d sub", "f file.txt"].sort());
  });

  test("empty dir returns empty string", async () => {
    const res = await fsListDir.execute("id", { path: scratch });
    expect(res.content[0]!.text).toBe("");
  });

  test("missing dir throws", async () => {
    await expect(fsListDir.execute("id", { path: join(scratch, "ghost") })).rejects.toThrow(/Failed to list/);
  });
});

describe("tools/filesystem — write_file", () => {
  test("writes absolute path", async () => {
    const p = join(scratch, "out.txt");
    const res = await fsWrite.execute("id", { path: p, content: "hi" });
    expect(res.content[0]!.text).toContain(`Wrote ${p}`);
    expect(res.content[0]!.text).toContain("(2 bytes)");
    expect(readFileSync(p, "utf-8")).toBe("hi");
  });

  test("creates parent directories as needed", async () => {
    const p = join(scratch, "nested", "deep", "file.txt");
    await fsWrite.execute("id", { path: p, content: "data" });
    expect(existsSync(p)).toBe(true);
    expect(readFileSync(p, "utf-8")).toBe("data");
  });

  test("relative path writes into OUTPUT_DIR", async () => {
    await fsWrite.execute("id", { path: "rel.txt", content: "r" });
    expect(readFileSync(join(OUTPUT_DIR_FOR_TEST, "rel.txt"), "utf-8")).toBe("r");
  });
});

// ripgrep may not be installed in all CI environments; detect and skip gracefully.
async function hasRipgrep(): Promise<boolean> {
  try {
    const proc = Bun.spawn(["which", "rg"], { stdout: "pipe", stderr: "pipe" });
    await proc.exited;
    return proc.exitCode === 0;
  } catch { return false; }
}

describe("tools/filesystem — search_files", () => {
  test("finds a pattern in a file via ripgrep", async () => {
    if (!(await hasRipgrep())) {
      // Without rg, the tool throws — ensure it throws cleanly (not silent success).
      await expect(fsSearch.execute("id", { pattern: "needle", path: scratch })).rejects.toThrow();
      return;
    }
    writeFileSync(join(scratch, "a.txt"), "foo needle bar\nbaz");
    const res = await fsSearch.execute("id", { pattern: "needle", path: scratch });
    expect(res.content[0]!.text).toContain("needle");
  });

  test("no matches returns 'No matches found.' sentinel", async () => {
    if (!(await hasRipgrep())) {
      await expect(fsSearch.execute("id", { pattern: "zzz", path: scratch })).rejects.toThrow();
      return;
    }
    writeFileSync(join(scratch, "a.txt"), "nothing here");
    const res = await fsSearch.execute("id", { pattern: "zzz-very-unlikely-pattern-zzz", path: scratch });
    expect(res.content[0]!.text).toContain("No matches found");
  });
});

describe("tools/filesystem — run_command", () => {
  test("runs echo successfully", async () => {
    const res = await fsRunCommand.execute("id", { command: "echo hello-from-test" });
    expect(res.content[0]!.text).toContain("hello-from-test");
  });

  test("failing command throws Error containing stderr / non-zero exit", async () => {
    await expect(fsRunCommand.execute("id", { command: "false" })).rejects.toThrow();
  });

  test("respects cwd", async () => {
    const res = await fsRunCommand.execute("id", { command: "pwd", cwd: scratch });
    // macOS may prefix with /private for tmpdir symlink
    expect(res.content[0]!.text).toContain(scratch.replace(/^\/private/, ""));
  });

  test("no-output command returns sentinel", async () => {
    const res = await fsRunCommand.execute("id", { command: "true" });
    expect(res.content[0]!.text).toBe("(no output)");
  });
});

// cleanup shared OUTPUT_DIR after suite
afterAll(() => {
  try { rmSync(OUTPUT_DIR_FOR_TEST, { recursive: true, force: true }); } catch {}
});
