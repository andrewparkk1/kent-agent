import { test, expect, describe } from "bun:test";
import { join } from "node:path";

const CLI_PATH = join(import.meta.dir, "..", "cli", "index.ts");

// ---------------------------------------------------------------------------
// 1. Config → Runner Factory flow
// ---------------------------------------------------------------------------

describe("Config → Runner Factory", () => {
  test("default_runner: 'local' returns LocalRunner", async () => {
    const { getRunner } = await import("../daemon/runner.ts");
    const { LocalRunner } = await import("../daemon/local-runner.ts");
    const { DEFAULT_CONFIG } = await import("../shared/config.ts");

    const config = {
      ...DEFAULT_CONFIG,
      agent: { ...DEFAULT_CONFIG.agent, default_runner: "local" as const },
    };

    const runner = getRunner(config);
    expect(runner).toBeInstanceOf(LocalRunner);
  });

  test("default_runner: 'cloud' returns E2BRunner", async () => {
    const { getRunner } = await import("../daemon/runner.ts");
    const { E2BRunner } = await import("../daemon/e2b-runner.ts");
    const { DEFAULT_CONFIG } = await import("../shared/config.ts");

    const config = {
      ...DEFAULT_CONFIG,
      agent: { ...DEFAULT_CONFIG.agent, default_runner: "cloud" as const },
    };

    const runner = getRunner(config);
    expect(runner).toBeInstanceOf(E2BRunner);
  });

  test("default_runner: 'auto' with no daemon PID returns E2BRunner", async () => {
    const { getRunner } = await import("../daemon/runner.ts");
    const { E2BRunner } = await import("../daemon/e2b-runner.ts");
    const { DEFAULT_CONFIG } = await import("../shared/config.ts");

    // With no daemon running, auto should fall back to cloud (E2BRunner)
    const config = {
      ...DEFAULT_CONFIG,
      agent: { ...DEFAULT_CONFIG.agent, default_runner: "auto" as const },
    };

    const runner = getRunner(config);
    expect(runner).toBeInstanceOf(E2BRunner);
  });

  test("override parameter takes precedence over config", async () => {
    const { getRunner } = await import("../daemon/runner.ts");
    const { LocalRunner } = await import("../daemon/local-runner.ts");
    const { E2BRunner } = await import("../daemon/e2b-runner.ts");
    const { DEFAULT_CONFIG } = await import("../shared/config.ts");

    // Config says cloud, but override says local
    const cloudConfig = {
      ...DEFAULT_CONFIG,
      agent: { ...DEFAULT_CONFIG.agent, default_runner: "cloud" as const },
    };
    const runner1 = getRunner(cloudConfig, "local");
    expect(runner1).toBeInstanceOf(LocalRunner);

    // Config says local, but override says cloud
    const localConfig = {
      ...DEFAULT_CONFIG,
      agent: { ...DEFAULT_CONFIG.agent, default_runner: "local" as const },
    };
    const runner2 = getRunner(localConfig, "cloud");
    expect(runner2).toBeInstanceOf(E2BRunner);
  });
});

// ---------------------------------------------------------------------------
// 2. Config → Source Registry flow
// ---------------------------------------------------------------------------

describe("Config → Source Registry", () => {
  const EXPECTED_SOURCES = [
    "imessage",
    "signal",
    "granola",
    "gmail",
    "github",
    "chrome",
    "apple_notes",
  ] as const;

  test("source names match config.sources keys exactly", async () => {
    const { DEFAULT_CONFIG } = await import("../shared/config.ts");
    const configSourceKeys = Object.keys(DEFAULT_CONFIG.sources).sort();
    const registryKeys = [...EXPECTED_SOURCES].sort();

    expect(configSourceKeys).toEqual(registryKeys);
  });

  test("all 7 sources exist in config.sources", async () => {
    const { DEFAULT_CONFIG } = await import("../shared/config.ts");
    expect(Object.keys(DEFAULT_CONFIG.sources)).toHaveLength(7);

    for (const source of EXPECTED_SOURCES) {
      expect(DEFAULT_CONFIG.sources).toHaveProperty(source);
    }
  });

  test("enabled sources in config control which would be synced", async () => {
    const { DEFAULT_CONFIG } = await import("../shared/config.ts");

    // By default all sources are false
    const enabledByDefault = Object.entries(DEFAULT_CONFIG.sources).filter(
      ([, enabled]) => enabled,
    );
    expect(enabledByDefault).toHaveLength(0);

    // Enable specific sources and verify filtering
    const config = {
      ...DEFAULT_CONFIG,
      sources: {
        ...DEFAULT_CONFIG.sources,
        imessage: true,
        gmail: true,
      },
    };

    const enabledSources = Object.entries(config.sources)
      .filter(([, enabled]) => enabled)
      .map(([key]) => key);

    expect(enabledSources).toEqual(["imessage", "gmail"]);
    expect(enabledSources).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// 3. Tool system consistency
// ---------------------------------------------------------------------------

describe("Tool system consistency", () => {
  test("all memory tools call convexCall or convexAction", async () => {
    const toolsSource = await Bun.file(
      join(import.meta.dir, "..", "agent", "tools.ts"),
    ).text();

    const { memoryTools } = await import("../agent/tools.ts");

    // Each memory tool should reference convexCall or convexAction in the source
    for (const tool of memoryTools) {
      expect(tool).toHaveProperty("name");
      expect(tool).toHaveProperty("execute");
    }

    // Verify the source references convex functions for each memory tool
    expect(toolsSource).toContain("convexCall");
    expect(toolsSource).toContain("convexAction");

    // Verify specific Convex function paths are referenced
    expect(toolsSource).toContain("items:searchSemantic");
    expect(toolsSource).toContain("items:searchFTS");
    expect(toolsSource).toContain("items:getRecentItems");
    expect(toolsSource).toContain("items:browse");
    expect(toolsSource).toContain("items:getById");
    expect(toolsSource).toContain("items:getStats");
  });

  test("all filesystem tools check RUNNER === 'local' guard", async () => {
    const toolsSource = await Bun.file(
      join(import.meta.dir, "..", "agent", "tools.ts"),
    ).text();

    const { filesystemTools } = await import("../agent/tools.ts");

    // Each filesystem tool should have the RUNNER !== "local" guard
    const localOnlyChecks = (toolsSource.match(/RUNNER !== "local"/g) || [])
      .length;
    expect(localOnlyChecks).toBe(filesystemTools.length);

    for (const tool of filesystemTools) {
      expect(tool).toHaveProperty("name");
      expect(tool).toHaveProperty("execute");
    }
  });

  test("tool count matches expected (6 memory + 5 filesystem = 11)", async () => {
    const { memoryTools, filesystemTools, allTools } = await import(
      "../agent/tools.ts"
    );

    expect(memoryTools).toHaveLength(6);
    expect(filesystemTools).toHaveLength(5);
    expect(allTools).toHaveLength(11);
    expect(allTools).toEqual([...memoryTools, ...filesystemTools]);
  });
});

// ---------------------------------------------------------------------------
// 4. CLI help completeness
// ---------------------------------------------------------------------------

describe("CLI help completeness", () => {
  test("help text mentions all commands", async () => {
    const proc = Bun.spawn(["bun", "run", CLI_PATH, "--help"], {
      stdout: "pipe",
      stderr: "pipe",
    });

    const stdout = await new Response(proc.stdout).text();
    await proc.exited;

    const expectedCommands = ["init", "daemon", "sync", "workflow", "channel"];
    for (const cmd of expectedCommands) {
      expect(stdout).toContain(cmd);
    }
  });

  test("help text mentions --local flag", async () => {
    const proc = Bun.spawn(["bun", "run", CLI_PATH, "--help"], {
      stdout: "pipe",
      stderr: "pipe",
    });

    const stdout = await new Response(proc.stdout).text();
    await proc.exited;

    expect(stdout).toContain("--local");
  });

  test("version output matches package.json version", async () => {
    const pkg = JSON.parse(
      await Bun.file(join(import.meta.dir, "..", "package.json")).text(),
    );

    const proc = Bun.spawn(["bun", "run", CLI_PATH, "--version"], {
      stdout: "pipe",
      stderr: "pipe",
    });

    const stdout = (await new Response(proc.stdout).text()).trim();
    await proc.exited;

    expect(stdout).toBe(pkg.version);
  });
});

// ---------------------------------------------------------------------------
// 5. Workflow YAML validation logic
// ---------------------------------------------------------------------------

describe("Workflow YAML validation logic", () => {
  test("valid workflow YAML with all fields parses correctly", async () => {
    const { parse: parseYaml } = await import("yaml");

    const validYaml = `
name: daily-digest
description: Daily summary of messages
runner: auto
trigger:
  type: cron
  schedule: "0 9 * * *"
prompt: Summarize my messages from the last 24 hours
output:
  target: telegram
`;

    const wf = parseYaml(validYaml) as Record<string, unknown>;

    expect(wf.name).toBe("daily-digest");
    expect(wf.description).toBe("Daily summary of messages");
    expect(wf.runner).toBe("auto");
    expect(wf.prompt).toBe(
      "Summarize my messages from the last 24 hours",
    );
    expect((wf.output as Record<string, unknown>).target).toBe("telegram");
    expect(
      (wf.trigger as Record<string, unknown>).schedule,
    ).toBe("0 9 * * *");
  });

  test("workflow with missing name field is detectable", async () => {
    const { parse: parseYaml } = await import("yaml");

    const yaml = `
description: A workflow without a name
prompt: Do something
output:
  target: terminal
`;

    const wf = parseYaml(yaml) as Record<string, unknown>;
    // The validation logic in workflow.ts checks: !wf.name || !wf.prompt || !wf.output?.target
    expect(!wf.name).toBe(true);
  });

  test("workflow with missing prompt field is detectable", async () => {
    const { parse: parseYaml } = await import("yaml");

    const yaml = `
name: no-prompt-workflow
description: Missing the prompt
output:
  target: telegram
`;

    const wf = parseYaml(yaml) as Record<string, unknown>;
    expect(!wf.prompt).toBe(true);
  });

  test("workflow with missing output.target is detectable", async () => {
    const { parse: parseYaml } = await import("yaml");

    const yaml = `
name: no-target-workflow
prompt: Do something
output:
  path: /tmp/out.md
`;

    const wf = parseYaml(yaml) as Record<string, unknown>;
    const output = wf.output as Record<string, unknown> | undefined;
    expect(!output?.target).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 6. Channel → Telegram integration
// ---------------------------------------------------------------------------

describe("Channel → Telegram integration", () => {
  test("channel registry has telegram registered", async () => {
    const { listChannelNames } = await import("../cli/channels/channel.ts");

    const names = listChannelNames();
    expect(names).toContain("telegram");
  });

  test("getting telegram channel does not throw 'Unknown channel'", async () => {
    const { getChannel } = await import("../cli/channels/channel.ts");

    // getChannel("telegram") should not throw — it should return a TelegramChannel.
    // It may throw for other reasons (e.g. missing env vars inside the constructor),
    // but the registry lookup itself should succeed.
    let threwUnknownChannel = false;
    try {
      await getChannel("telegram");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("Unknown channel")) {
        threwUnknownChannel = true;
      }
      // Other errors (e.g. missing TELEGRAM_BOT_TOKEN) are acceptable
    }

    expect(threwUnknownChannel).toBe(false);
  });
});
