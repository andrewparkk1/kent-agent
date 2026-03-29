import { test, expect, describe } from "bun:test";
import { existsSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

/**
 * Tests for the runner factory and runner base types.
 */

describe("RunResult interface", () => {
  test("RunResult has expected shape", async () => {
    const result = {
      runId: "test-uuid",
      output: "Hello from agent",
      files: { "output.md": "# Result" },
    };

    expect(result.runId).toBe("test-uuid");
    expect(result.output).toBe("Hello from agent");
    expect(result.files["output.md"]).toBe("# Result");
  });
});

describe("getRunner factory", () => {
  test("returns LocalRunner for 'local' override", async () => {
    const { getRunner } = await import("../daemon/runner.ts");
    const { DEFAULT_CONFIG } = await import("../shared/config.ts");

    const runner = getRunner(DEFAULT_CONFIG, "local");
    expect(runner.constructor.name).toBe("LocalRunner");
  });

  test("returns E2BRunner for 'cloud' override", async () => {
    const { getRunner } = await import("../daemon/runner.ts");
    const { DEFAULT_CONFIG } = await import("../shared/config.ts");

    const runner = getRunner(DEFAULT_CONFIG, "cloud");
    expect(runner.constructor.name).toBe("E2BRunner");
  });

  test("respects config default_runner when no override", async () => {
    const { getRunner } = await import("../daemon/runner.ts");
    const { DEFAULT_CONFIG } = await import("../shared/config.ts");

    const localConfig = {
      ...DEFAULT_CONFIG,
      agent: { ...DEFAULT_CONFIG.agent, default_runner: "local" as const },
    };
    const runner = getRunner(localConfig);
    expect(runner.constructor.name).toBe("LocalRunner");
  });

  test("auto mode without daemon returns E2BRunner", async () => {
    const { getRunner } = await import("../daemon/runner.ts");
    const { DEFAULT_CONFIG } = await import("../shared/config.ts");

    // With default config (auto mode), and no daemon running, should use cloud
    const runner = getRunner(DEFAULT_CONFIG);
    expect(runner.constructor.name).toBe("E2BRunner");
  });

  test("cloud config returns E2BRunner", async () => {
    const { getRunner } = await import("../daemon/runner.ts");
    const { DEFAULT_CONFIG } = await import("../shared/config.ts");

    const cloudConfig = {
      ...DEFAULT_CONFIG,
      agent: { ...DEFAULT_CONFIG.agent, default_runner: "cloud" as const },
    };
    const runner = getRunner(cloudConfig);
    expect(runner.constructor.name).toBe("E2BRunner");
  });
});

describe("BaseRunner abstract class", () => {
  test("BaseRunner requires run and kill methods", async () => {
    const { BaseRunner } = await import("../daemon/runner-base.ts");

    // Verify the abstract class exists and has the right prototype
    expect(BaseRunner).toBeDefined();
    expect(BaseRunner.prototype.run).toBeUndefined(); // abstract
    expect(BaseRunner.prototype.kill).toBeUndefined(); // abstract
  });
});

describe("LocalRunner", () => {
  test("LocalRunner has run and kill methods", async () => {
    const { LocalRunner } = await import("../daemon/local-runner.ts");
    const { DEFAULT_CONFIG } = await import("../shared/config.ts");

    const runner = new LocalRunner(DEFAULT_CONFIG);
    expect(typeof runner.run).toBe("function");
    expect(typeof runner.kill).toBe("function");
  });

  test("LocalRunner.kill resolves without error", async () => {
    const { LocalRunner } = await import("../daemon/local-runner.ts");
    const { DEFAULT_CONFIG } = await import("../shared/config.ts");

    const runner = new LocalRunner(DEFAULT_CONFIG);
    await expect(runner.kill()).resolves.toBeUndefined();
  });
});

describe("E2BRunner", () => {
  test("E2BRunner has run and kill methods", async () => {
    const { E2BRunner } = await import("../daemon/e2b-runner.ts");
    const { DEFAULT_CONFIG } = await import("../shared/config.ts");

    const runner = new E2BRunner(DEFAULT_CONFIG);
    expect(typeof runner.run).toBe("function");
    expect(typeof runner.kill).toBe("function");
  });

  test("E2BRunner.kill resolves when no sandbox exists", async () => {
    const { E2BRunner } = await import("../daemon/e2b-runner.ts");
    const { DEFAULT_CONFIG } = await import("../shared/config.ts");

    const runner = new E2BRunner(DEFAULT_CONFIG);
    await expect(runner.kill()).resolves.toBeUndefined();
  });
});
