import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import { existsSync, mkdirSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { Config } from "@shared/config.ts";
import { DEFAULT_CONFIG } from "@shared/config.ts";

/**
 * Tests for config loading/saving logic.
 *
 * Uses a temp directory to avoid touching the real ~/.kent.
 * Re-implements the load/save logic against a custom path since
 * the module uses hardcoded paths.
 */

function tempDir(): string {
  const dir = join(tmpdir(), `kent-test-${crypto.randomUUID()}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function loadConfigFrom(dir: string, configPath: string): Config {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  if (!existsSync(configPath)) {
    writeFileSync(configPath, JSON.stringify(DEFAULT_CONFIG, null, 2), "utf-8");
    return DEFAULT_CONFIG;
  }
  try {
    const raw = readFileSync(configPath, "utf-8");
    return JSON.parse(raw) as Config;
  } catch {
    return DEFAULT_CONFIG;
  }
}

function saveConfigTo(dir: string, configPath: string, config: Config): void {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(configPath, JSON.stringify(config, null, 2), "utf-8");
}

describe("DEFAULT_CONFIG", () => {
  test("has all required top-level keys", () => {
    expect(DEFAULT_CONFIG).toHaveProperty("core");
    expect(DEFAULT_CONFIG).toHaveProperty("keys");
    expect(DEFAULT_CONFIG).toHaveProperty("sources");
    expect(DEFAULT_CONFIG).toHaveProperty("daemon");
    expect(DEFAULT_CONFIG).toHaveProperty("agent");
  });

  test("all sources default to false", () => {
    for (const [, enabled] of Object.entries(DEFAULT_CONFIG.sources)) {
      expect(enabled).toBe(false);
    }
  });

  test("has all 10 source toggles", () => {
    const sourceKeys = Object.keys(DEFAULT_CONFIG.sources);
    expect(sourceKeys).toContain("imessage");
    expect(sourceKeys).toContain("signal");
    expect(sourceKeys).toContain("granola");
    expect(sourceKeys).toContain("gmail");
    expect(sourceKeys).toContain("gcal");
    expect(sourceKeys).toContain("gtasks");
    expect(sourceKeys).toContain("gdrive");
    expect(sourceKeys).toContain("github");
    expect(sourceKeys).toContain("chrome");
    expect(sourceKeys).toContain("apple_notes");
    expect(sourceKeys.length).toBe(10);
  });

  test("daemon sync interval is a positive number", () => {
    expect(DEFAULT_CONFIG.daemon.sync_interval_minutes).toBeGreaterThan(0);
  });

  test("agent has reasonable defaults", () => {
    expect(DEFAULT_CONFIG.agent.default_model).toBeString();
    expect(DEFAULT_CONFIG.agent.default_model.length).toBeGreaterThan(0);
  });

  test("keys default to empty strings", () => {
    expect(DEFAULT_CONFIG.keys.anthropic).toBe("");
    expect(DEFAULT_CONFIG.keys.openai).toBe("");
  });
});

describe("Config load/save", () => {
  let dir: string;
  let configPath: string;

  beforeEach(() => {
    dir = tempDir();
    configPath = join(dir, "config.json");
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test("loadConfig creates default config when file missing", () => {
    const config = loadConfigFrom(dir, configPath);
    expect(config).toEqual(DEFAULT_CONFIG);
    expect(existsSync(configPath)).toBe(true);
  });

  test("loadConfig reads existing config", () => {
    const custom: Config = {
      ...DEFAULT_CONFIG,
      sources: { ...DEFAULT_CONFIG.sources, imessage: true, gmail: true },
      daemon: { sync_interval_minutes: 15 },
    };
    writeFileSync(configPath, JSON.stringify(custom, null, 2), "utf-8");

    const loaded = loadConfigFrom(dir, configPath);
    expect(loaded.sources.imessage).toBe(true);
    expect(loaded.sources.gmail).toBe(true);
    expect(loaded.sources.signal).toBe(false);
    expect(loaded.daemon.sync_interval_minutes).toBe(15);
  });

  test("loadConfig returns default on malformed JSON", () => {
    writeFileSync(configPath, "not valid json {{{", "utf-8");
    const config = loadConfigFrom(dir, configPath);
    expect(config).toEqual(DEFAULT_CONFIG);
  });

  test("saveConfig writes valid JSON", () => {
    const config: Config = {
      ...DEFAULT_CONFIG,
      keys: { anthropic: "sk-test-key", openai: "sk-openai" },
    };
    saveConfigTo(dir, configPath, config);

    const raw = readFileSync(configPath, "utf-8");
    const parsed = JSON.parse(raw);
    expect(parsed.keys.anthropic).toBe("sk-test-key");
    expect(parsed.keys.openai).toBe("sk-openai");
  });

  test("saveConfig then loadConfig roundtrip preserves data", () => {
    const config: Config = {
      ...DEFAULT_CONFIG,
      sources: { ...DEFAULT_CONFIG.sources, github: true, chrome: true },
      agent: { default_model: "custom-model" },
    };
    saveConfigTo(dir, configPath, config);
    const loaded = loadConfigFrom(dir, configPath);

    expect(loaded.sources.github).toBe(true);
    expect(loaded.sources.chrome).toBe(true);
    expect(loaded.agent.default_model).toBe("custom-model");
  });

  test("saveConfig creates directory if it doesn't exist", () => {
    const nestedDir = join(dir, "nested", "deep");
    const nestedPath = join(nestedDir, "config.json");
    saveConfigTo(nestedDir, nestedPath, DEFAULT_CONFIG);
    expect(existsSync(nestedPath)).toBe(true);
  });
});
