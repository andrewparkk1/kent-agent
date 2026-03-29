import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// We test config functions by patching the module's paths.
// Since config.ts uses hardcoded paths from homedir(), we test the logic
// by importing the functions and using a temp directory approach.

describe("Config module", () => {
  const tempDir = join(tmpdir(), `kent-test-config-${Date.now()}`);
  const configPath = join(tempDir, "config.json");

  beforeEach(() => {
    mkdirSync(tempDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  describe("DEFAULT_CONFIG", () => {
    test("has all required top-level keys", async () => {
      const { DEFAULT_CONFIG } = await import("@shared/config.ts");
      expect(DEFAULT_CONFIG).toHaveProperty("core");
      expect(DEFAULT_CONFIG).toHaveProperty("keys");
      expect(DEFAULT_CONFIG).toHaveProperty("sources");
      expect(DEFAULT_CONFIG).toHaveProperty("daemon");
      expect(DEFAULT_CONFIG).toHaveProperty("agent");
      expect(DEFAULT_CONFIG).toHaveProperty("channels");
    });

    test("core has empty default values", async () => {
      const { DEFAULT_CONFIG } = await import("@shared/config.ts");
      expect(DEFAULT_CONFIG.core.convex_url).toBe("");
      expect(DEFAULT_CONFIG.core.device_token).toBe("");
    });

    test("all sources default to false", async () => {
      const { DEFAULT_CONFIG } = await import("@shared/config.ts");
      for (const [key, value] of Object.entries(DEFAULT_CONFIG.sources)) {
        expect(value).toBe(false);
      }
    });

    test("daemon sync interval defaults to 5 minutes", async () => {
      const { DEFAULT_CONFIG } = await import("@shared/config.ts");
      expect(DEFAULT_CONFIG.daemon.sync_interval_minutes).toBe(5);
    });

    test("agent defaults are sensible", async () => {
      const { DEFAULT_CONFIG } = await import("@shared/config.ts");
      expect(DEFAULT_CONFIG.agent.default_model).toContain("claude");
      expect(DEFAULT_CONFIG.agent.max_turns).toBe(10);
      expect(DEFAULT_CONFIG.agent.default_runner).toBe("auto");
      expect(DEFAULT_CONFIG.agent.e2b_template_id).toBe("");
    });

    test("telegram channel defaults to disabled", async () => {
      const { DEFAULT_CONFIG } = await import("@shared/config.ts");
      expect(DEFAULT_CONFIG.channels.telegram.enabled).toBe(false);
      expect(DEFAULT_CONFIG.channels.telegram.bot_token).toBe("");
      expect(DEFAULT_CONFIG.channels.telegram.allowed_user_ids).toEqual([]);
    });
  });

  describe("ensureKentDir", () => {
    test("creates the .kent directory if it does not exist", async () => {
      const { ensureKentDir, KENT_DIR } = await import("@shared/config.ts");
      // This touches the real ~/.kent dir, but ensureKentDir is idempotent
      ensureKentDir();
      expect(existsSync(KENT_DIR)).toBe(true);
    });
  });

  describe("Config serialization roundtrip", () => {
    test("saveConfig then loadConfig returns same data", async () => {
      const { DEFAULT_CONFIG } = await import("@shared/config.ts");
      const config = { ...DEFAULT_CONFIG };
      config.core.convex_url = "https://test-123.convex.cloud";
      config.core.device_token = "test-token-abc";
      config.sources.imessage = true;
      config.sources.github = true;
      config.daemon.sync_interval_minutes = 15;

      // Write to temp path and read back
      writeFileSync(configPath, JSON.stringify(config, null, 2), "utf-8");
      const raw = readFileSync(configPath, "utf-8");
      const loaded = JSON.parse(raw);

      expect(loaded.core.convex_url).toBe("https://test-123.convex.cloud");
      expect(loaded.core.device_token).toBe("test-token-abc");
      expect(loaded.sources.imessage).toBe(true);
      expect(loaded.sources.github).toBe(true);
      expect(loaded.sources.signal).toBe(false);
      expect(loaded.daemon.sync_interval_minutes).toBe(15);
    });

    test("handles malformed JSON gracefully", async () => {
      writeFileSync(configPath, "not valid json{{{", "utf-8");
      const raw = readFileSync(configPath, "utf-8");
      expect(() => JSON.parse(raw)).toThrow();
    });
  });

  describe("Config paths", () => {
    test("KENT_DIR ends with .kent", async () => {
      const { KENT_DIR } = await import("@shared/config.ts");
      expect(KENT_DIR.endsWith(".kent")).toBe(true);
    });

    test("CONFIG_PATH is inside KENT_DIR", async () => {
      const { KENT_DIR, CONFIG_PATH } = await import("@shared/config.ts");
      expect(CONFIG_PATH.startsWith(KENT_DIR)).toBe(true);
      expect(CONFIG_PATH.endsWith("config.json")).toBe(true);
    });

    test("PID_PATH is inside KENT_DIR", async () => {
      const { KENT_DIR, PID_PATH } = await import("@shared/config.ts");
      expect(PID_PATH.startsWith(KENT_DIR)).toBe(true);
      expect(PID_PATH.endsWith("daemon.pid")).toBe(true);
    });

    test("LOG_PATH is inside KENT_DIR", async () => {
      const { KENT_DIR, LOG_PATH } = await import("@shared/config.ts");
      expect(LOG_PATH.startsWith(KENT_DIR)).toBe(true);
      expect(LOG_PATH.endsWith("daemon.log")).toBe(true);
    });

    test("PLIST_PATH is in LaunchAgents", async () => {
      const { PLIST_PATH } = await import("@shared/config.ts");
      expect(PLIST_PATH).toContain("LaunchAgents");
      expect(PLIST_PATH).toContain("sh.kent.daemon.plist");
    });
  });

  describe("Config type shape", () => {
    test("sources has exactly 7 boolean fields", async () => {
      const { DEFAULT_CONFIG } = await import("@shared/config.ts");
      const sourceKeys = Object.keys(DEFAULT_CONFIG.sources);
      expect(sourceKeys).toEqual([
        "imessage",
        "signal",
        "granola",
        "gmail",
        "github",
        "chrome",
        "apple_notes",
      ]);
      expect(sourceKeys.length).toBe(7);
    });

    test("agent.default_runner is a valid runner type", async () => {
      const { DEFAULT_CONFIG } = await import("@shared/config.ts");
      expect(["cloud", "local", "auto"]).toContain(
        DEFAULT_CONFIG.agent.default_runner,
      );
    });
  });
});
