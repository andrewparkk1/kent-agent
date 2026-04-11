import { test, expect, describe } from "bun:test";

const CLI_PATH = new URL("../cli/index.ts", import.meta.url).pathname;

const TEST_HOME = "/tmp/kent-test-cli-home";

async function runCli(args: string[]): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  // Ensure minimal config exists so init guard doesn't block command routing
  const { mkdirSync, writeFileSync, existsSync } = await import("node:fs");
  const configDir = `${TEST_HOME}/.kent`;
  if (!existsSync(`${configDir}/config.json`)) {
    mkdirSync(configDir, { recursive: true });
    writeFileSync(`${configDir}/config.json`, "{}");
  }

  const proc = Bun.spawn(["bun", "run", CLI_PATH, ...args], {
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, HOME: TEST_HOME },
  });

  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  const exitCode = await proc.exited;

  return { stdout, stderr, exitCode };
}

describe("CLI --version", () => {
  test("prints version number", async () => {
    const { stdout, exitCode } = await runCli(["--version"]);
    expect(exitCode).toBe(0);
    expect(stdout.trim()).toMatch(/^\d+\.\d+\.\d+$/);
  });

  test("-v also prints version", async () => {
    const { stdout, exitCode } = await runCli(["-v"]);
    expect(exitCode).toBe(0);
    expect(stdout.trim()).toMatch(/^\d+\.\d+\.\d+$/);
  });

  test("version matches package.json", async () => {
    const { stdout } = await runCli(["--version"]);
    const pkg = await Bun.file(new URL("../package.json", import.meta.url).pathname).json();
    expect(stdout.trim()).toBe(pkg.version);
  });
});

describe("CLI --help", () => {
  test("prints help text", async () => {
    const { stdout, exitCode } = await runCli(["--help"]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("kent");
    expect(stdout).toContain("Usage:");
    expect(stdout).toContain("init");
    expect(stdout).toContain("daemon");
    expect(stdout).toContain("sync");
  });

  test("-h also prints help", async () => {
    const { stdout, exitCode } = await runCli(["-h"]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("Usage:");
  });
});

describe("CLI unknown command", () => {
  test("exits with error for unknown command", async () => {
    const { stderr, exitCode } = await runCli(["foobar"]);
    expect(exitCode).toBe(1);
    expect(stderr).toContain("Unknown command: foobar");
  });
});

describe("CLI daemon subcommand validation", () => {
  test("daemon with no subcommand shows usage", async () => {
    const { stdout, exitCode } = await runCli(["daemon"]);
    expect(exitCode).toBe(1);
    expect(stdout).toContain("Usage: kent daemon");
  });

  test("daemon with invalid subcommand shows usage", async () => {
    const { stdout, exitCode } = await runCli(["daemon", "invalid"]);
    expect(exitCode).toBe(1);
    expect(stdout).toContain("Usage: kent daemon");
  });
});
