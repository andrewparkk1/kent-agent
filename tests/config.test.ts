import { test, expect, beforeEach, afterEach, describe } from "bun:test";
import { existsSync, mkdirSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("Config types and defaults", () => {
  test("DEFAULT_CONFIG has expected shape", async () => {
    const { DEFAULT_CONFIG } = await import("../shared/config.ts");

    expect(DEFAULT_CONFIG.core.device_token).toBe("");
    expect(DEFAULT_CONFIG.keys.openai).toBe("");
    expect(DEFAULT_CONFIG.keys.anthropic).toBe("");
    expect(DEFAULT_CONFIG.daemon.sync_interval_minutes).toBe(5);
    expect(DEFAULT_CONFIG.agent.default_model).toBe("claude-sonnet-4-20250514");
    expect(DEFAULT_CONFIG.agent.max_turns).toBe(10);
  });

  test("DEFAULT_CONFIG sources are all disabled", async () => {
    const { DEFAULT_CONFIG } = await import("../shared/config.ts");

    expect(DEFAULT_CONFIG.sources.imessage).toBe(false);
    expect(DEFAULT_CONFIG.sources.signal).toBe(false);
    expect(DEFAULT_CONFIG.sources.granola).toBe(false);
    expect(DEFAULT_CONFIG.sources.gmail).toBe(false);
    expect(DEFAULT_CONFIG.sources.github).toBe(false);
    expect(DEFAULT_CONFIG.sources.chrome).toBe(false);
    expect(DEFAULT_CONFIG.sources.apple_notes).toBe(false);
  });

  test("KENT_DIR points to ~/.kent", async () => {
    const { KENT_DIR } = await import("../shared/config.ts");
    const { homedir } = await import("node:os");
    expect(KENT_DIR).toBe(join(homedir(), ".kent"));
  });

  test("CONFIG_PATH is config.json inside KENT_DIR", async () => {
    const { CONFIG_PATH, KENT_DIR } = await import("../shared/config.ts");
    expect(CONFIG_PATH).toBe(join(KENT_DIR, "config.json"));
  });

  test("PID_PATH is daemon.pid inside KENT_DIR", async () => {
    const { PID_PATH, KENT_DIR } = await import("../shared/config.ts");
    expect(PID_PATH).toBe(join(KENT_DIR, "daemon.pid"));
  });

  test("LOG_PATH is daemon.log inside KENT_DIR", async () => {
    const { LOG_PATH, KENT_DIR } = await import("../shared/config.ts");
    expect(LOG_PATH).toBe(join(KENT_DIR, "daemon.log"));
  });

  test("PLIST_PATH is in LaunchAgents", async () => {
    const { PLIST_PATH } = await import("../shared/config.ts");
    expect(PLIST_PATH).toContain("Library/LaunchAgents/sh.kent.daemon.plist");
  });
});

describe("Config file I/O", () => {
  const tempDir = join(tmpdir(), `kent-test-config-${Date.now()}`);
  const configPath = join(tempDir, "config.json");

  beforeEach(() => {
    mkdirSync(tempDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  test("saveConfig writes valid JSON", async () => {
    const { DEFAULT_CONFIG } = await import("../shared/config.ts");

    writeFileSync(configPath, JSON.stringify(DEFAULT_CONFIG, null, 2), "utf-8");

    expect(existsSync(configPath)).toBe(true);
    const raw = readFileSync(configPath, "utf-8");
    const parsed = JSON.parse(raw);
    expect(parsed.core.device_token).toBe("");
    expect(parsed.daemon.sync_interval_minutes).toBe(5);
  });

  test("config roundtrip preserves all fields", async () => {
    const { DEFAULT_CONFIG } = await import("../shared/config.ts");

    const config = {
      ...DEFAULT_CONFIG,
      core: { device_token: "tok123" },
      keys: { openai: "sk-test", anthropic: "sk-ant-test" },
      sources: { ...DEFAULT_CONFIG.sources, imessage: true, github: true },
      agent: { ...DEFAULT_CONFIG.agent, max_turns: 25 },
    };

    writeFileSync(configPath, JSON.stringify(config, null, 2), "utf-8");
    const raw = readFileSync(configPath, "utf-8");
    const restored = JSON.parse(raw);

    expect(restored.core.device_token).toBe("tok123");
    expect(restored.keys.openai).toBe("sk-test");
    expect(restored.sources.imessage).toBe(true);
    expect(restored.sources.github).toBe(true);
    expect(restored.sources.signal).toBe(false);
    expect(restored.agent.max_turns).toBe(25);
  });

  test("loadConfig returns DEFAULT_CONFIG when file missing", async () => {
    const { DEFAULT_CONFIG } = await import("../shared/config.ts");

    const nonExistent = join(tempDir, "nope.json");
    expect(existsSync(nonExistent)).toBe(false);

    let result: typeof DEFAULT_CONFIG;
    try {
      const raw = readFileSync(nonExistent, "utf-8");
      result = JSON.parse(raw);
    } catch {
      result = DEFAULT_CONFIG;
    }
    expect(result).toEqual(DEFAULT_CONFIG);
  });

  test("loadConfig returns DEFAULT_CONFIG for invalid JSON", async () => {
    const { DEFAULT_CONFIG } = await import("../shared/config.ts");

    const badPath = join(tempDir, "bad.json");
    writeFileSync(badPath, "not json {{{", "utf-8");

    let result: typeof DEFAULT_CONFIG;
    try {
      const raw = readFileSync(badPath, "utf-8");
      result = JSON.parse(raw);
    } catch {
      result = DEFAULT_CONFIG;
    }
    expect(result).toEqual(DEFAULT_CONFIG);
  });
});
