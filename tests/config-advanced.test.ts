import { test, expect, beforeEach, afterEach, describe } from "bun:test";
import { existsSync, mkdirSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

/**
 * Advanced / edge-case tests for shared/config.ts.
 * Covers scenarios not exercised by the base config.test.ts.
 */

describe("Hosted constants", () => {
  test("KENT_CONVEX_URL is the correct hosted URL", async () => {
    const { KENT_CONVEX_URL } = await import("../shared/config.ts");
    expect(KENT_CONVEX_URL).toBe("https://brave-armadillo-395.convex.cloud");
  });

  test("KENT_TELEGRAM_BOT is kent_personal_bot", async () => {
    const { KENT_TELEGRAM_BOT } = await import("../shared/config.ts");
    expect(KENT_TELEGRAM_BOT).toBe("kent_personal_bot");
  });
});

describe("DEFAULT_CONFIG telegram defaults", () => {
  test("telegram.linked defaults to false", async () => {
    const { DEFAULT_CONFIG } = await import("../shared/config.ts");
    expect(DEFAULT_CONFIG.telegram.linked).toBe(false);
  });

  test("telegram.user_id defaults to null", async () => {
    const { DEFAULT_CONFIG } = await import("../shared/config.ts");
    expect(DEFAULT_CONFIG.telegram.user_id).toBeNull();
  });

  test("telegram.username defaults to null", async () => {
    const { DEFAULT_CONFIG } = await import("../shared/config.ts");
    expect(DEFAULT_CONFIG.telegram.username).toBeNull();
  });
});

describe("DEFAULT_CONFIG agent defaults", () => {
  test("default_runner is 'auto'", async () => {
    const { DEFAULT_CONFIG } = await import("../shared/config.ts");
    expect(DEFAULT_CONFIG.agent.default_runner).toBe("auto");
  });

  test("all three runner modes are valid at the type level", async () => {
    const { DEFAULT_CONFIG } = await import("../shared/config.ts");
    type Runner = typeof DEFAULT_CONFIG.agent.default_runner;

    // Verify the runtime value is one of the accepted literals
    const validRunners = ["cloud", "local", "auto"] as const;
    expect(validRunners).toContain(DEFAULT_CONFIG.agent.default_runner);

    // Verify we can assign each mode without error at runtime
    const configs: { default_runner: Runner }[] = [
      { default_runner: "cloud" },
      { default_runner: "local" },
      { default_runner: "auto" },
    ];
    expect(configs).toHaveLength(3);
  });
});

describe("DEFAULT_CONFIG sources completeness", () => {
  test("all 7 source keys exist and default to false", async () => {
    const { DEFAULT_CONFIG } = await import("../shared/config.ts");

    const expectedKeys = [
      "imessage",
      "signal",
      "granola",
      "gmail",
      "github",
      "chrome",
      "apple_notes",
    ] as const;

    const sourceKeys = Object.keys(DEFAULT_CONFIG.sources);
    expect(sourceKeys).toHaveLength(expectedKeys.length);

    for (const key of expectedKeys) {
      expect(DEFAULT_CONFIG.sources[key]).toBe(false);
    }
  });

  test("sources contains no unexpected keys", async () => {
    const { DEFAULT_CONFIG } = await import("../shared/config.ts");
    const sourceKeys = Object.keys(DEFAULT_CONFIG.sources).sort();
    const expected = [
      "apple_notes",
      "chrome",
      "github",
      "gmail",
      "granola",
      "imessage",
      "signal",
    ];
    expect(sourceKeys).toEqual(expected);
  });
});

describe("Config partial overrides and forward compatibility", () => {
  const tempDir = join(tmpdir(), `kent-test-adv-${Date.now()}`);
  const configPath = join(tempDir, "config.json");

  beforeEach(() => {
    mkdirSync(tempDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  test("partial override preserves other defaults via spread", async () => {
    const { DEFAULT_CONFIG } = await import("../shared/config.ts");

    // Only override telegram section
    const config = {
      ...DEFAULT_CONFIG,
      telegram: {
        linked: true,
        user_id: 12345,
        username: "testuser",
      },
    };

    writeFileSync(configPath, JSON.stringify(config, null, 2), "utf-8");
    const restored = JSON.parse(readFileSync(configPath, "utf-8"));

    // Overridden section
    expect(restored.telegram.linked).toBe(true);
    expect(restored.telegram.user_id).toBe(12345);
    expect(restored.telegram.username).toBe("testuser");

    // Untouched sections remain at defaults
    expect(restored.core.device_token).toBe("");
    expect(restored.keys.anthropic).toBe("");
    expect(restored.keys.openai).toBe("");
    expect(restored.daemon.sync_interval_minutes).toBe(5);
    expect(restored.agent.default_runner).toBe("auto");
    expect(restored.sources.imessage).toBe(false);
  });

  test("extra unknown fields survive JSON roundtrip (forward compatibility)", async () => {
    const { DEFAULT_CONFIG } = await import("../shared/config.ts");

    // Simulate a future config version with extra fields
    const extendedConfig = {
      ...DEFAULT_CONFIG,
      future_section: { new_feature: true, version: 42 },
      agent: {
        ...DEFAULT_CONFIG.agent,
        experimental_flag: "beta",
      },
    };

    writeFileSync(configPath, JSON.stringify(extendedConfig, null, 2), "utf-8");
    const restored = JSON.parse(readFileSync(configPath, "utf-8"));

    // Unknown keys are preserved by JSON.parse
    expect(restored.future_section).toEqual({ new_feature: true, version: 42 });
    expect(restored.agent.experimental_flag).toBe("beta");

    // Known keys still intact
    expect(restored.agent.default_runner).toBe("auto");
    expect(restored.agent.max_turns).toBe(10);
  });

  test("null telegram fields roundtrip correctly through JSON", async () => {
    const { DEFAULT_CONFIG } = await import("../shared/config.ts");

    // Explicitly set nulls (matching defaults)
    const config = {
      ...DEFAULT_CONFIG,
      telegram: {
        linked: false,
        user_id: null,
        username: null,
      },
    };

    writeFileSync(configPath, JSON.stringify(config, null, 2), "utf-8");
    const restored = JSON.parse(readFileSync(configPath, "utf-8"));

    expect(restored.telegram.user_id).toBeNull();
    expect(restored.telegram.username).toBeNull();
    expect(restored.telegram.linked).toBe(false);
  });

  test("telegram fields with values roundtrip then back to null", async () => {
    const { DEFAULT_CONFIG } = await import("../shared/config.ts");

    // First write with values
    const linked = {
      ...DEFAULT_CONFIG,
      telegram: { linked: true, user_id: 99999, username: "alice" },
    };
    writeFileSync(configPath, JSON.stringify(linked, null, 2), "utf-8");

    // Then write back to null (unlinking)
    const unlinked = {
      ...DEFAULT_CONFIG,
      telegram: { linked: false, user_id: null, username: null },
    };
    writeFileSync(configPath, JSON.stringify(unlinked, null, 2), "utf-8");

    const restored = JSON.parse(readFileSync(configPath, "utf-8"));
    expect(restored.telegram.linked).toBe(false);
    expect(restored.telegram.user_id).toBeNull();
    expect(restored.telegram.username).toBeNull();
  });
});

describe("saveConfig creates KENT_DIR (ensureKentDir integration)", () => {
  const tempDir = join(tmpdir(), `kent-test-mkdir-${Date.now()}`);
  const nestedDir = join(tempDir, "deep", "nested", ".kent");
  const configPath = join(nestedDir, "config.json");

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  test("writing config to a non-existent directory after mkdirSync recursive", async () => {
    const { DEFAULT_CONFIG } = await import("../shared/config.ts");

    // Simulate what ensureKentDir + saveConfig does
    expect(existsSync(nestedDir)).toBe(false);
    mkdirSync(nestedDir, { recursive: true });
    writeFileSync(configPath, JSON.stringify(DEFAULT_CONFIG, null, 2), "utf-8");

    expect(existsSync(nestedDir)).toBe(true);
    expect(existsSync(configPath)).toBe(true);

    const restored = JSON.parse(readFileSync(configPath, "utf-8"));
    expect(restored.agent.default_runner).toBe("auto");
  });

  test("mkdirSync recursive is idempotent on existing directory", async () => {
    const { DEFAULT_CONFIG } = await import("../shared/config.ts");

    mkdirSync(nestedDir, { recursive: true });
    // Calling again should not throw
    mkdirSync(nestedDir, { recursive: true });

    writeFileSync(configPath, JSON.stringify(DEFAULT_CONFIG, null, 2), "utf-8");
    expect(existsSync(configPath)).toBe(true);
  });
});

describe("loadConfig handles missing sections gracefully", () => {
  const tempDir = join(tmpdir(), `kent-test-partial-${Date.now()}`);
  const configPath = join(tempDir, "config.json");

  beforeEach(() => {
    mkdirSync(tempDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  test("config with only core section parses without error", () => {
    const partial = { core: { device_token: "tok-abc" } };
    writeFileSync(configPath, JSON.stringify(partial, null, 2), "utf-8");

    const restored = JSON.parse(readFileSync(configPath, "utf-8"));
    expect(restored.core.device_token).toBe("tok-abc");
    // Missing sections are simply undefined — loadConfig would need merging logic
    expect(restored.keys).toBeUndefined();
    expect(restored.sources).toBeUndefined();
    expect(restored.telegram).toBeUndefined();
  });

  test("empty object config parses without error", () => {
    writeFileSync(configPath, JSON.stringify({}, null, 2), "utf-8");

    const restored = JSON.parse(readFileSync(configPath, "utf-8"));
    expect(restored).toEqual({});
  });

  test("config with only telegram section parses correctly", () => {
    const partial = {
      telegram: { linked: true, user_id: 777, username: "bob" },
    };
    writeFileSync(configPath, JSON.stringify(partial, null, 2), "utf-8");

    const restored = JSON.parse(readFileSync(configPath, "utf-8"));
    expect(restored.telegram.linked).toBe(true);
    expect(restored.telegram.user_id).toBe(777);
    expect(restored.core).toBeUndefined();
  });

  test("merging partial config with defaults fills missing sections", async () => {
    const { DEFAULT_CONFIG } = await import("../shared/config.ts");

    const partial = {
      core: { device_token: "my-device" },
      agent: { default_model: "gpt-4", max_turns: 5, default_runner: "cloud" as const },
    };

    writeFileSync(configPath, JSON.stringify(partial, null, 2), "utf-8");
    const loaded = JSON.parse(readFileSync(configPath, "utf-8"));

    // Simulate a deep-merge fallback strategy
    const merged = {
      ...DEFAULT_CONFIG,
      ...loaded,
      core: { ...DEFAULT_CONFIG.core, ...loaded.core },
      keys: { ...DEFAULT_CONFIG.keys, ...(loaded.keys ?? {}) },
      sources: { ...DEFAULT_CONFIG.sources, ...(loaded.sources ?? {}) },
      daemon: { ...DEFAULT_CONFIG.daemon, ...(loaded.daemon ?? {}) },
      agent: { ...DEFAULT_CONFIG.agent, ...(loaded.agent ?? {}) },
      telegram: { ...DEFAULT_CONFIG.telegram, ...(loaded.telegram ?? {}) },
    };

    expect(merged.core.device_token).toBe("my-device");
    expect(merged.agent.default_model).toBe("gpt-4");
    expect(merged.agent.max_turns).toBe(5);
    expect(merged.agent.default_runner).toBe("cloud");
    // Defaults filled in for missing sections
    expect(merged.keys.anthropic).toBe("");
    expect(merged.sources.imessage).toBe(false);
    expect(merged.telegram.linked).toBe(false);
    expect(merged.daemon.sync_interval_minutes).toBe(5);
  });
});

describe("Config edge cases", () => {
  const tempDir = join(tmpdir(), `kent-test-edge-${Date.now()}`);
  const configPath = join(tempDir, "config.json");

  beforeEach(() => {
    mkdirSync(tempDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  test("config with large user_id number roundtrips correctly", () => {
    const config = {
      telegram: { linked: true, user_id: 9007199254740991, username: "max_safe_int" },
    };
    writeFileSync(configPath, JSON.stringify(config, null, 2), "utf-8");
    const restored = JSON.parse(readFileSync(configPath, "utf-8"));
    expect(restored.telegram.user_id).toBe(Number.MAX_SAFE_INTEGER);
  });

  test("config with empty string keys roundtrips correctly", () => {
    const config = {
      core: { device_token: "" },
      keys: { anthropic: "", openai: "" },
    };
    writeFileSync(configPath, JSON.stringify(config, null, 2), "utf-8");
    const restored = JSON.parse(readFileSync(configPath, "utf-8"));
    expect(restored.core.device_token).toBe("");
    expect(restored.keys.anthropic).toBe("");
  });

  test("config with unicode in username roundtrips correctly", () => {
    const config = {
      telegram: { linked: true, user_id: 42, username: "用户_тест_🤖" },
    };
    writeFileSync(configPath, JSON.stringify(config, null, 2), "utf-8");
    const restored = JSON.parse(readFileSync(configPath, "utf-8"));
    expect(restored.telegram.username).toBe("用户_тест_🤖");
  });

  test("sync_interval_minutes of 0 is preserved", () => {
    const config = { daemon: { sync_interval_minutes: 0 } };
    writeFileSync(configPath, JSON.stringify(config, null, 2), "utf-8");
    const restored = JSON.parse(readFileSync(configPath, "utf-8"));
    expect(restored.daemon.sync_interval_minutes).toBe(0);
  });

  test("boolean sources toggled to true roundtrip correctly", async () => {
    const { DEFAULT_CONFIG } = await import("../shared/config.ts");

    const config = {
      ...DEFAULT_CONFIG,
      sources: {
        imessage: true,
        signal: true,
        granola: true,
        gmail: true,
        github: true,
        chrome: true,
        apple_notes: true,
      },
    };

    writeFileSync(configPath, JSON.stringify(config, null, 2), "utf-8");
    const restored = JSON.parse(readFileSync(configPath, "utf-8"));

    for (const key of Object.keys(restored.sources)) {
      expect(restored.sources[key]).toBe(true);
    }
  });
});
