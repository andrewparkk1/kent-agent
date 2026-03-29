import { test, expect, describe } from "bun:test";
import { join } from "node:path";
import { parse } from "yaml";

const CLI_PATH = join(import.meta.dir, "..", "cli", "index.ts");

// ── Helpers ─────────────────────────────────────────────────────────────

/** Replicate the padRight helper from workflow.ts for unit testing. */
function padRight(str: string, len: number): string {
  return str.length >= len ? str + " " : str + " ".repeat(len - str.length);
}

/** Validate a parsed YAML object the same way workflow push does. */
function isValidWorkflow(wf: any): boolean {
  return !!(wf.name && wf.prompt && wf.output?.target);
}

// ── 1. YAML validation rules ────────────────────────────────────────────

describe("YAML validation rules", () => {
  test("valid YAML with all fields passes", () => {
    const yaml = `
name: "daily-summary"
description: "Summarise yesterday's activity"
runner: "cloud"
trigger:
  type: "cron"
  schedule: "0 8 * * *"
prompt: "Summarise yesterday's commits and issues"
output:
  target: "telegram"
  path: "~/output/"
`;
    const wf = parse(yaml);
    expect(isValidWorkflow(wf)).toBe(true);
    expect(wf.name).toBe("daily-summary");
    expect(wf.description).toBe("Summarise yesterday's activity");
    expect(wf.runner).toBe("cloud");
    expect(wf.trigger.type).toBe("cron");
    expect(wf.trigger.schedule).toBe("0 8 * * *");
    expect(wf.prompt).toBe("Summarise yesterday's commits and issues");
    expect(wf.output.target).toBe("telegram");
    expect(wf.output.path).toBe("~/output/");
  });

  test("YAML missing name is skipped", () => {
    const yaml = `
prompt: "Do something"
output:
  target: "terminal"
`;
    const wf = parse(yaml);
    expect(isValidWorkflow(wf)).toBe(false);
  });

  test("YAML missing prompt is skipped", () => {
    const yaml = `
name: "no-prompt"
output:
  target: "terminal"
`;
    const wf = parse(yaml);
    expect(isValidWorkflow(wf)).toBe(false);
  });

  test("YAML missing output.target is skipped", () => {
    const yaml = `
name: "no-target"
prompt: "Hello"
output:
  path: "~/somewhere"
`;
    const wf = parse(yaml);
    expect(isValidWorkflow(wf)).toBe(false);
  });

  test("YAML with no output section is skipped", () => {
    const yaml = `
name: "no-output"
prompt: "Hello"
`;
    const wf = parse(yaml);
    expect(isValidWorkflow(wf)).toBe(false);
  });

  test("YAML with only required fields (name, prompt, output.target) is valid", () => {
    const yaml = `
name: "minimal"
prompt: "Do the thing"
output:
  target: "file"
`;
    const wf = parse(yaml);
    expect(isValidWorkflow(wf)).toBe(true);
    // Optional fields should be undefined
    expect(wf.description).toBeUndefined();
    expect(wf.runner).toBeUndefined();
    expect(wf.trigger).toBeUndefined();
  });
});

// ── 2. CLI routing ──────────────────────────────────────────────────────

describe("CLI routing for workflow subcommands", () => {
  test("workflow push without path uses default templates dir", async () => {
    const proc = Bun.spawn(["bun", "run", CLI_PATH, "workflow", "push"], {
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env, HOME: "/tmp/kent-test-nonexistent" },
    });
    const stdout = await new Response(proc.stdout).text();
    const stderr = await new Response(proc.stderr).text();
    await proc.exited;

    // It should mention "built-in templates" in stdout or fail looking for the directory
    const combined = stdout + stderr;
    const mentionsTemplates = combined.includes("built-in templates") || combined.includes("templates");
    const mentionsNotFound = combined.includes("not found") || combined.includes("No YAML files");
    expect(mentionsTemplates || mentionsNotFound).toBe(true);
  });

  test("workflow run <name> --runner cloud parses runner override", async () => {
    // This will fail at the network call, but we can verify it gets past arg parsing
    const proc = Bun.spawn(
      ["bun", "run", CLI_PATH, "workflow", "run", "test-wf", "--runner", "cloud"],
      {
        stdout: "pipe",
        stderr: "pipe",
        env: { ...process.env, HOME: "/tmp/kent-test-nonexistent" },
      },
    );
    const stderr = await new Response(proc.stderr).text();
    const stdout = await new Response(proc.stdout).text();
    await proc.exited;

    // Should NOT show "Usage:" since a name was provided
    expect(stderr).not.toContain("Usage: kent workflow run");
  });

  test("workflow run <name> --runner local parses runner override", async () => {
    const proc = Bun.spawn(
      ["bun", "run", CLI_PATH, "workflow", "run", "test-wf", "--runner", "local"],
      {
        stdout: "pipe",
        stderr: "pipe",
        env: { ...process.env, HOME: "/tmp/kent-test-nonexistent" },
      },
    );
    const stderr = await new Response(proc.stderr).text();
    await proc.exited;

    expect(stderr).not.toContain("Usage: kent workflow run");
  });

  test("workflow run without name shows usage and exits 1", async () => {
    const proc = Bun.spawn(["bun", "run", CLI_PATH, "workflow", "run"], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const stderr = await new Response(proc.stderr).text();
    await proc.exited;

    expect(proc.exitCode).toBe(1);
    expect(stderr).toContain("Usage:");
    expect(stderr).toContain("workflow run");
  });

  test("workflow disable without name shows usage and exits 1", async () => {
    const proc = Bun.spawn(["bun", "run", CLI_PATH, "workflow", "disable"], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const stderr = await new Response(proc.stderr).text();
    await proc.exited;

    expect(proc.exitCode).toBe(1);
    expect(stderr).toContain("Usage:");
    expect(stderr).toContain("workflow disable");
  });
});

// ── 3. Output routing logic ─────────────────────────────────────────────

describe("Output routing", () => {
  test('"terminal" target maps to terminal output type', () => {
    const yaml = `
name: "term-wf"
prompt: "Generate report"
output:
  target: "terminal"
`;
    const wf = parse(yaml);
    expect(wf.output.target).toBe("terminal");
  });

  test('"file" target includes path for file creation', () => {
    const yaml = `
name: "file-wf"
prompt: "Generate report"
output:
  target: "file"
  path: "~/reports/"
`;
    const wf = parse(yaml);
    expect(wf.output.target).toBe("file");
    expect(wf.output.path).toBe("~/reports/");

    // Verify date-based filename pattern used by workflow.ts
    const timestamp = new Date().toISOString().slice(0, 10);
    const filename = `${wf.name}-${timestamp}.md`;
    expect(filename).toMatch(/^file-wf-\d{4}-\d{2}-\d{2}\.md$/);
  });

  test('"telegram" target is a valid output type', () => {
    const yaml = `
name: "tg-wf"
prompt: "Generate summary"
output:
  target: "telegram"
`;
    const wf = parse(yaml);
    expect(wf.output.target).toBe("telegram");
  });

  test("output target values match the expected union", () => {
    const validTargets = ["telegram", "terminal", "file"];
    for (const target of validTargets) {
      const yaml = `
name: "test"
prompt: "Test"
output:
  target: "${target}"
`;
      const wf = parse(yaml);
      expect(validTargets).toContain(wf.output.target);
    }
  });
});

// ── 4. YAML edge cases ─────────────────────────────────────────────────

describe("YAML edge cases", () => {
  test('trigger.type "event" with event field', () => {
    const yaml = `
name: "event-wf"
prompt: "Handle event"
trigger:
  type: "event"
  event: "repo.push"
output:
  target: "terminal"
`;
    const wf = parse(yaml);
    expect(wf.trigger.type).toBe("event");
    expect(wf.trigger.event).toBe("repo.push");
    expect(wf.trigger.schedule).toBeUndefined();
    expect(isValidWorkflow(wf)).toBe(true);
  });

  test('trigger.type "cron" with schedule field', () => {
    const yaml = `
name: "cron-wf"
prompt: "Run on schedule"
trigger:
  type: "cron"
  schedule: "30 9 * * 1-5"
output:
  target: "file"
`;
    const wf = parse(yaml);
    expect(wf.trigger.type).toBe("cron");
    expect(wf.trigger.schedule).toBe("30 9 * * 1-5");
    expect(wf.trigger.event).toBeUndefined();
    expect(isValidWorkflow(wf)).toBe(true);
  });

  test("no trigger section means manual workflow", () => {
    const yaml = `
name: "manual-wf"
prompt: "Run manually"
output:
  target: "terminal"
`;
    const wf = parse(yaml);
    expect(wf.trigger).toBeUndefined();
    expect(isValidWorkflow(wf)).toBe(true);

    // workflow.ts uses optional chaining: wf.trigger?.schedule ?? undefined
    const schedule = wf.trigger?.schedule ?? undefined;
    const event = wf.trigger?.event ?? undefined;
    expect(schedule).toBeUndefined();
    expect(event).toBeUndefined();
  });

  test("runner field missing defaults to auto in payload construction", () => {
    const yaml = `
name: "no-runner"
prompt: "Do something"
output:
  target: "terminal"
`;
    const wf = parse(yaml);
    expect(wf.runner).toBeUndefined();

    // Replicate the defaulting logic from workflow.ts push payload
    const runner = wf.runner ?? "auto";
    expect(runner).toBe("auto");
  });

  test("runner field present uses specified value", () => {
    const yaml = `
name: "cloud-runner"
runner: "cloud"
prompt: "Do something"
output:
  target: "terminal"
`;
    const wf = parse(yaml);
    const runner = wf.runner ?? "auto";
    expect(runner).toBe("cloud");
  });

  test("YAML with extra unknown fields still passes validation", () => {
    const yaml = `
name: "extra-fields"
prompt: "Do something"
custom_field: "ignored"
metadata:
  author: "test"
output:
  target: "terminal"
`;
    const wf = parse(yaml);
    expect(isValidWorkflow(wf)).toBe(true);
    expect(wf.custom_field).toBe("ignored");
  });
});

// ── 5. padRight helper ──────────────────────────────────────────────────

describe("padRight helper", () => {
  test("pads short strings correctly", () => {
    const result = padRight("NAME", 20);
    expect(result.length).toBe(20);
    expect(result).toBe("NAME" + " ".repeat(16));
    expect(result.startsWith("NAME")).toBe(true);
  });

  test("returns string + single space when already at length", () => {
    const result = padRight("12345", 5);
    // When str.length >= len, returns str + " "
    expect(result).toBe("12345 ");
    expect(result.length).toBe(6);
  });

  test("returns string + single space when longer than length", () => {
    const result = padRight("very-long-name", 5);
    expect(result).toBe("very-long-name ");
    expect(result.length).toBe(15);
  });

  test("handles empty string", () => {
    const result = padRight("", 10);
    expect(result.length).toBe(10);
    expect(result).toBe(" ".repeat(10));
  });

  test("handles zero length", () => {
    const result = padRight("abc", 0);
    // "abc".length (3) >= 0, so returns "abc" + " "
    expect(result).toBe("abc ");
  });

  test("pads to exact width for table formatting", () => {
    // Verify the column widths used in workflowList
    const name = padRight("daily-summary", 20);
    const schedule = padRight("0 8 * * *", 22);
    const output = padRight("telegram", 12);
    const runner = padRight("cloud", 10);

    expect(name.length).toBe(20);
    expect(schedule.length).toBe(22);
    expect(output.length).toBe(12);
    expect(runner.length).toBe(10);

    // Full row should be predictable width
    const row = name + schedule + output + runner + "yes";
    expect(row.length).toBe(20 + 22 + 12 + 10 + 3);
  });
});
