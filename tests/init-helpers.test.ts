import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import { existsSync, mkdirSync, rmSync, writeFileSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

/**
 * Tests for init command helper functions.
 * We test the pure logic extracted from init.ts:
 * - Workflow template installation
 * - Plist generation
 * - Encryption key derivation
 */

describe("Workflow template installation", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = join(tmpdir(), `kent-test-init-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(tempDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  // Reproduce the built-in workflow definitions
  const BUILTIN_WORKFLOWS: Record<string, object> = {
    "daily-brief.yaml": {
      name: "daily-brief",
      prompt: "Generate my daily briefing.",
      schedule: "0 8 * * *",
      runner: "cloud",
      output: "telegram",
    },
    "weekly-review.yaml": {
      name: "weekly-review",
      prompt: "Generate a weekly review.",
      schedule: "0 17 * * 5",
      runner: "cloud",
      output: "telegram",
    },
    "pr-summary.yaml": {
      name: "pr-summary",
      prompt: "Summarize my open pull requests.",
      trigger: "github",
      runner: "local",
      output: "stdout",
    },
    "meeting-followup.yaml": {
      name: "meeting-followup",
      prompt: "Based on the latest Granola meeting notes, extract action items.",
      trigger: "granola",
      runner: "cloud",
      output: "telegram",
    },
  };

  function installWorkflowTemplates(workflowDir: string): number {
    if (!existsSync(workflowDir)) {
      mkdirSync(workflowDir, { recursive: true });
    }
    let installed = 0;
    for (const [filename, workflow] of Object.entries(BUILTIN_WORKFLOWS)) {
      const dest = join(workflowDir, filename);
      if (!existsSync(dest)) {
        const lines: string[] = [];
        for (const [k, v] of Object.entries(workflow)) {
          lines.push(`${k}: ${JSON.stringify(v)}`);
        }
        writeFileSync(dest, lines.join("\n") + "\n", "utf-8");
        installed++;
      }
    }
    return installed;
  }

  test("installs 4 workflow templates", () => {
    const workflowDir = join(tempDir, "workflows");
    const count = installWorkflowTemplates(workflowDir);

    expect(count).toBe(4);
    expect(existsSync(join(workflowDir, "daily-brief.yaml"))).toBe(true);
    expect(existsSync(join(workflowDir, "weekly-review.yaml"))).toBe(true);
    expect(existsSync(join(workflowDir, "pr-summary.yaml"))).toBe(true);
    expect(existsSync(join(workflowDir, "meeting-followup.yaml"))).toBe(true);
  });

  test("does not overwrite existing templates", () => {
    const workflowDir = join(tempDir, "workflows");
    mkdirSync(workflowDir, { recursive: true });

    // Write a custom daily-brief
    writeFileSync(join(workflowDir, "daily-brief.yaml"), "custom: content\n", "utf-8");

    const count = installWorkflowTemplates(workflowDir);

    // Should only install the other 3
    expect(count).toBe(3);

    // Custom file should be preserved
    const custom = readFileSync(join(workflowDir, "daily-brief.yaml"), "utf-8");
    expect(custom).toBe("custom: content\n");
  });

  test("idempotent — second run installs 0", () => {
    const workflowDir = join(tempDir, "workflows");

    installWorkflowTemplates(workflowDir);
    const count = installWorkflowTemplates(workflowDir);

    expect(count).toBe(0);
  });

  test("created files contain expected YAML-like content", () => {
    const workflowDir = join(tempDir, "workflows");
    installWorkflowTemplates(workflowDir);

    const dailyBrief = readFileSync(join(workflowDir, "daily-brief.yaml"), "utf-8");
    expect(dailyBrief).toContain('name: "daily-brief"');
    expect(dailyBrief).toContain('schedule: "0 8 * * *"');
    expect(dailyBrief).toContain('runner: "cloud"');
    expect(dailyBrief).toContain('output: "telegram"');
  });

  test("creates workflow directory if missing", () => {
    const workflowDir = join(tempDir, "nested", "deep", "workflows");
    expect(existsSync(workflowDir)).toBe(false);

    installWorkflowTemplates(workflowDir);

    expect(existsSync(workflowDir)).toBe(true);
    expect(readdirSync(workflowDir).length).toBe(4);
  });
});

describe("Plist generation", () => {
  function generatePlist(bunPath: string, indexPath: string, kentDir: string): string {
    return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>sh.kent.daemon</string>
  <key>ProgramArguments</key>
  <array>
    <string>${bunPath}</string>
    <string>${indexPath}</string>
    <string>daemon</string>
    <string>start</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${kentDir}/daemon.log</string>
  <key>StandardErrorPath</key>
  <string>${kentDir}/daemon.err</string>
</dict>
</plist>`;
  }

  test("generates valid XML plist", () => {
    const plist = generatePlist("/usr/local/bin/bun", "/path/to/cli/index.ts", "/Users/test/.kent");

    expect(plist).toContain('<?xml version="1.0"');
    expect(plist).toContain("<plist version=\"1.0\">");
    expect(plist).toContain("sh.kent.daemon");
    expect(plist).toContain("<true/>");
  });

  test("includes bun path in ProgramArguments", () => {
    const plist = generatePlist("/opt/homebrew/bin/bun", "/app/cli/index.ts", "/Users/test/.kent");
    expect(plist).toContain("/opt/homebrew/bin/bun");
    expect(plist).toContain("/app/cli/index.ts");
  });

  test("includes daemon start command", () => {
    const plist = generatePlist("/usr/local/bin/bun", "/path/index.ts", "/Users/test/.kent");
    expect(plist).toContain("<string>daemon</string>");
    expect(plist).toContain("<string>start</string>");
  });

  test("sets KeepAlive and RunAtLoad to true", () => {
    const plist = generatePlist("/usr/local/bin/bun", "/path/index.ts", "/Users/test/.kent");

    // Check that both KeepAlive and RunAtLoad are followed by <true/>
    expect(plist).toContain("<key>RunAtLoad</key>\n  <true/>");
    expect(plist).toContain("<key>KeepAlive</key>\n  <true/>");
  });

  test("includes log paths", () => {
    const plist = generatePlist("/usr/local/bin/bun", "/path/index.ts", "/Users/test/.kent");
    expect(plist).toContain("/Users/test/.kent/daemon.log");
    expect(plist).toContain("/Users/test/.kent/daemon.err");
  });
});

describe("Encryption helpers", () => {
  test("AES-256-GCM key derivation works", async () => {
    const deviceToken = "test-device-token-abc123";
    const salt = crypto.getRandomValues(new Uint8Array(16));

    // Derive key using PBKDF2 (same as init.ts)
    const keyMaterial = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(deviceToken),
      "PBKDF2",
      false,
      ["deriveKey"],
    );

    const key = await crypto.subtle.deriveKey(
      { name: "PBKDF2", salt: salt as unknown as ArrayBuffer, iterations: 600_000, hash: "SHA-256" },
      keyMaterial,
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt"],
    );

    expect(key).toBeDefined();
    expect(key.type).toBe("secret");
  });

  test("encrypt and verify roundtrip", async () => {
    const deviceToken = "roundtrip-test-token";
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const keys = { anthropic: "sk-ant-test", openai: "sk-test" };

    // Derive key
    const keyMaterial = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(deviceToken),
      "PBKDF2",
      false,
      ["deriveKey"],
    );
    const cryptoKey = await crypto.subtle.deriveKey(
      { name: "PBKDF2", salt: salt as unknown as ArrayBuffer, iterations: 600_000, hash: "SHA-256" },
      keyMaterial,
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"],
    );

    // Encrypt
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const plaintext = new TextEncoder().encode(JSON.stringify(keys));
    const ciphertext = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv },
      cryptoKey,
      plaintext,
    );

    expect(ciphertext.byteLength).toBeGreaterThan(0);

    // Decrypt
    const decrypted = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv },
      cryptoKey,
      ciphertext,
    );

    const restored = JSON.parse(new TextDecoder().decode(decrypted));
    expect(restored.anthropic).toBe("sk-ant-test");
    expect(restored.openai).toBe("sk-test");
  });

  test("different device tokens produce different ciphertext", async () => {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const plaintext = new TextEncoder().encode('{"key":"value"}');
    const iv = crypto.getRandomValues(new Uint8Array(12));

    async function encrypt(token: string): Promise<ArrayBuffer> {
      const keyMaterial = await crypto.subtle.importKey(
        "raw",
        new TextEncoder().encode(token),
        "PBKDF2",
        false,
        ["deriveKey"],
      );
      const key = await crypto.subtle.deriveKey(
        { name: "PBKDF2", salt: salt as unknown as ArrayBuffer, iterations: 600_000, hash: "SHA-256" },
        keyMaterial,
        { name: "AES-GCM", length: 256 },
        false,
        ["encrypt"],
      );
      return crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plaintext);
    }

    const ct1 = new Uint8Array(await encrypt("token-a"));
    const ct2 = new Uint8Array(await encrypt("token-b"));

    // Ciphertexts should differ
    let same = ct1.length === ct2.length;
    if (same) {
      for (let i = 0; i < ct1.length; i++) {
        if (ct1[i] !== ct2[i]) { same = false; break; }
      }
    }
    expect(same).toBe(false);
  });
});
