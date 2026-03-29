import { test, expect, describe } from "bun:test";
import { join } from "node:path";

const CLI_PATH = join(import.meta.dir, "..", "cli", "index.ts");

describe("Workflow command routing", () => {
  test("workflow without subcommand shows usage", async () => {
    const proc = Bun.spawn(["bun", "run", CLI_PATH, "workflow"], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const stdout = await new Response(proc.stdout).text();
    await proc.exited;

    expect(proc.exitCode).toBe(1);
    expect(stdout).toContain("workflow push");
    expect(stdout).toContain("workflow list");
    expect(stdout).toContain("workflow run");
    expect(stdout).toContain("workflow disable");
  });

  test("workflow with invalid subcommand shows usage", async () => {
    const proc = Bun.spawn(["bun", "run", CLI_PATH, "workflow", "invalid"], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const stdout = await new Response(proc.stdout).text();
    await proc.exited;

    expect(proc.exitCode).toBe(1);
    expect(stdout).toContain("Usage:");
  });

  test("workflow run without name shows usage", async () => {
    const proc = Bun.spawn(["bun", "run", CLI_PATH, "workflow", "run"], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const stderr = await new Response(proc.stderr).text();
    await proc.exited;

    expect(proc.exitCode).toBe(1);
    expect(stderr).toContain("Usage:");
  });

  test("workflow disable without name shows usage", async () => {
    const proc = Bun.spawn(["bun", "run", CLI_PATH, "workflow", "disable"], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const stderr = await new Response(proc.stderr).text();
    await proc.exited;

    expect(proc.exitCode).toBe(1);
    expect(stderr).toContain("Usage:");
  });
});

describe("Workflow YAML parsing", () => {
  test("yaml package can parse workflow format", async () => {
    const { parse } = await import("yaml");

    const yamlContent = `
name: "test-workflow"
description: "A test workflow"
runner: "cloud"
trigger:
  type: "cron"
  schedule: "0 8 * * *"
prompt: "Do something useful"
output:
  target: "terminal"
`;

    const parsed = parse(yamlContent);
    expect(parsed.name).toBe("test-workflow");
    expect(parsed.prompt).toBe("Do something useful");
    expect(parsed.trigger.type).toBe("cron");
    expect(parsed.trigger.schedule).toBe("0 8 * * *");
    expect(parsed.output.target).toBe("terminal");
    expect(parsed.runner).toBe("cloud");
  });

  test("yaml parsing handles minimal workflow", async () => {
    const { parse } = await import("yaml");

    const yamlContent = `
name: "minimal"
prompt: "Hello"
output:
  target: "terminal"
`;

    const parsed = parse(yamlContent);
    expect(parsed.name).toBe("minimal");
    expect(parsed.prompt).toBe("Hello");
    expect(parsed.output.target).toBe("terminal");
  });

  test("yaml parsing handles all output targets", async () => {
    const { parse } = await import("yaml");

    for (const target of ["telegram", "terminal", "file"]) {
      const yaml = `
name: "test"
prompt: "Test"
output:
  target: "${target}"
`;
      const parsed = parse(yaml);
      expect(parsed.output.target).toBe(target);
    }
  });
});
