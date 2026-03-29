import { test, expect, describe } from "bun:test";

describe("CLI routing (index.ts)", () => {
  const CLI_PATH = new URL("../cli/index.ts", import.meta.url).pathname;

  describe("--version flag", () => {
    test("prints version and exits 0", async () => {
      const proc = Bun.spawn(["bun", "run", CLI_PATH, "--version"], {
        stdout: "pipe",
        stderr: "pipe",
      });
      const stdout = await new Response(proc.stdout).text();
      const code = await proc.exited;
      expect(code).toBe(0);
      expect(stdout.trim()).toMatch(/^\d+\.\d+\.\d+$/);
    });

    test("-v also prints version", async () => {
      const proc = Bun.spawn(["bun", "run", CLI_PATH, "-v"], {
        stdout: "pipe",
        stderr: "pipe",
      });
      const stdout = await new Response(proc.stdout).text();
      const code = await proc.exited;
      expect(code).toBe(0);
      expect(stdout.trim()).toMatch(/^\d+\.\d+\.\d+$/);
    });

    test("version matches package.json", async () => {
      const proc = Bun.spawn(["bun", "run", CLI_PATH, "--version"], {
        stdout: "pipe",
        stderr: "pipe",
      });
      const stdout = await new Response(proc.stdout).text();
      await proc.exited;

      const pkgPath = new URL("../package.json", import.meta.url).pathname;
      const pkg = JSON.parse(await Bun.file(pkgPath).text());
      expect(stdout.trim()).toBe(pkg.version);
    });
  });

  describe("--help flag", () => {
    test("prints help text and exits 0", async () => {
      const proc = Bun.spawn(["bun", "run", CLI_PATH, "--help"], {
        stdout: "pipe",
        stderr: "pipe",
      });
      const stdout = await new Response(proc.stdout).text();
      const code = await proc.exited;
      expect(code).toBe(0);
      expect(stdout).toContain("kent");
      expect(stdout).toContain("Usage:");
      expect(stdout).toContain("init");
      expect(stdout).toContain("daemon");
      expect(stdout).toContain("sync");
      expect(stdout).toContain("workflow");
      expect(stdout).toContain("channel");
    });

    test("-h also prints help", async () => {
      const proc = Bun.spawn(["bun", "run", CLI_PATH, "-h"], {
        stdout: "pipe",
        stderr: "pipe",
      });
      const stdout = await new Response(proc.stdout).text();
      const code = await proc.exited;
      expect(code).toBe(0);
      expect(stdout).toContain("Usage:");
    });

    test("help mentions --local flag", async () => {
      const proc = Bun.spawn(["bun", "run", CLI_PATH, "--help"], {
        stdout: "pipe",
        stderr: "pipe",
      });
      const stdout = await new Response(proc.stdout).text();
      await proc.exited;
      expect(stdout).toContain("--local");
    });
  });

  describe("unknown command", () => {
    test("prints error and exits 1 for unknown command", async () => {
      const proc = Bun.spawn(
        ["bun", "run", CLI_PATH, "nonexistent-command"],
        {
          stdout: "pipe",
          stderr: "pipe",
        },
      );
      const stderr = await new Response(proc.stderr).text();
      const code = await proc.exited;
      expect(code).toBe(1);
      expect(stderr).toContain("Unknown command: nonexistent-command");
    });
  });

  describe("daemon subcommand validation", () => {
    test("daemon without subcommand shows usage", async () => {
      const proc = Bun.spawn(["bun", "run", CLI_PATH, "daemon"], {
        stdout: "pipe",
        stderr: "pipe",
      });
      const stdout = await new Response(proc.stdout).text();
      const code = await proc.exited;
      expect(code).toBe(1);
      expect(stdout).toContain("Usage:");
      expect(stdout).toContain("start");
      expect(stdout).toContain("stop");
      expect(stdout).toContain("status");
    });

    test("daemon with invalid subcommand shows usage", async () => {
      const proc = Bun.spawn(
        ["bun", "run", CLI_PATH, "daemon", "invalid"],
        {
          stdout: "pipe",
          stderr: "pipe",
        },
      );
      const stdout = await new Response(proc.stdout).text();
      const code = await proc.exited;
      expect(code).toBe(1);
      expect(stdout).toContain("Usage:");
    });
  });

  describe("workflow subcommand validation", () => {
    test("workflow without subcommand shows usage", async () => {
      const proc = Bun.spawn(["bun", "run", CLI_PATH, "workflow"], {
        stdout: "pipe",
        stderr: "pipe",
      });
      const stdout = await new Response(proc.stdout).text();
      const code = await proc.exited;
      expect(code).toBe(1);
      expect(stdout).toContain("Usage:");
      expect(stdout).toContain("push");
      expect(stdout).toContain("list");
      expect(stdout).toContain("run");
      expect(stdout).toContain("disable");
    });
  });

  describe("channel subcommand validation", () => {
    test("channel without subcommand shows usage", async () => {
      const proc = Bun.spawn(["bun", "run", CLI_PATH, "channel"], {
        stdout: "pipe",
        stderr: "pipe",
      });
      const stdout = await new Response(proc.stdout).text();
      const code = await proc.exited;
      expect(code).toBe(1);
      expect(stdout).toContain("Usage:");
      expect(stdout).toContain("start");
      expect(stdout).toContain("stop");
      expect(stdout).toContain("status");
    });
  });

  describe("sync subcommand", () => {
    test("sync with unknown --source exits with error", async () => {
      const proc = Bun.spawn(
        ["bun", "run", CLI_PATH, "sync", "--source", "nonexistent"],
        {
          stdout: "pipe",
          stderr: "pipe",
        },
      );
      const stderr = await new Response(proc.stderr).text();
      const code = await proc.exited;
      expect(code).toBe(1);
      expect(stderr).toContain('Unknown source: "nonexistent"');
    });
  });
});
