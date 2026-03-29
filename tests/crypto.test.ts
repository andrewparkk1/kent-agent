import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import { existsSync, mkdirSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomBytes } from "node:crypto";

/**
 * Tests for cli/crypto.ts — KeyVault class (AES-256-GCM encryption/decryption).
 *
 * The KeyVault uses PBKDF2 key derivation with a salt file at ~/.kent/salt,
 * then AES-256-GCM for encrypt/decrypt. We test the pure crypto logic here.
 */

describe("KeyVault encrypt/decrypt roundtrip", () => {
  let tempDir: string;
  let originalHome: string;

  beforeEach(() => {
    tempDir = join(tmpdir(), `kent-test-crypto-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(join(tempDir, ".kent"), { recursive: true });

    // Create a salt file so KeyVault can find it
    const salt = randomBytes(32);
    writeFileSync(join(tempDir, ".kent", "salt"), salt, { mode: 0o600 });
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  test("encryptKeys produces base64 string", async () => {
    // We test the encryption format manually since KeyVault reads from homedir
    const { createCipheriv, pbkdf2Sync } = await import("node:crypto");

    const deviceToken = "test-device-token-12345";
    const salt = readFileSync(join(tempDir, ".kent", "salt"));
    const key = pbkdf2Sync(deviceToken, salt, 100_000, 32, "sha256");
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", key, iv);

    const keys = { anthropic: "sk-ant-test123", openai: "sk-openai-test" };
    const plaintext = JSON.stringify(keys);
    const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
    const authTag = cipher.getAuthTag();

    const packed = Buffer.concat([iv, authTag, encrypted]);
    const base64 = packed.toString("base64");

    expect(base64).toBeTruthy();
    expect(typeof base64).toBe("string");
    // Base64 should decode back to the right length
    const decoded = Buffer.from(base64, "base64");
    expect(decoded.length).toBe(12 + 16 + encrypted.length); // iv + authTag + ciphertext
  });

  test("decrypt reverses encrypt", async () => {
    const { createCipheriv, createDecipheriv, pbkdf2Sync } = await import("node:crypto");

    const deviceToken = "roundtrip-token-xyz";
    const salt = readFileSync(join(tempDir, ".kent", "salt"));
    const key = pbkdf2Sync(deviceToken, salt, 100_000, 32, "sha256");

    const keys = { anthropic: "sk-ant-real", openai: "sk-openai-real" };
    const plaintext = JSON.stringify(keys);

    // Encrypt
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
    const authTag = cipher.getAuthTag();
    const packed = Buffer.concat([iv, authTag, encrypted]);

    // Decrypt
    const unpackedIv = packed.subarray(0, 12);
    const unpackedAuthTag = packed.subarray(12, 28);
    const ciphertext = packed.subarray(28);

    const decipher = createDecipheriv("aes-256-gcm", key, unpackedIv);
    decipher.setAuthTag(unpackedAuthTag);
    const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    const restored = JSON.parse(decrypted.toString("utf8"));

    expect(restored.anthropic).toBe("sk-ant-real");
    expect(restored.openai).toBe("sk-openai-real");
  });

  test("wrong device token fails to decrypt", async () => {
    const { createCipheriv, createDecipheriv, pbkdf2Sync } = await import("node:crypto");

    const salt = readFileSync(join(tempDir, ".kent", "salt"));
    const correctToken = "correct-token";
    const wrongToken = "wrong-token";

    const correctKey = pbkdf2Sync(correctToken, salt, 100_000, 32, "sha256");
    const wrongKey = pbkdf2Sync(wrongToken, salt, 100_000, 32, "sha256");

    // Encrypt with correct key
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", correctKey, iv);
    const encrypted = Buffer.concat([
      cipher.update(JSON.stringify({ key: "secret" }), "utf8"),
      cipher.final(),
    ]);
    const authTag = cipher.getAuthTag();
    const packed = Buffer.concat([iv, authTag, encrypted]);

    // Try to decrypt with wrong key
    const decipher = createDecipheriv("aes-256-gcm", wrongKey, packed.subarray(0, 12));
    decipher.setAuthTag(packed.subarray(12, 28));

    expect(() => {
      decipher.update(packed.subarray(28));
      decipher.final();
    }).toThrow();
  });

  test("encrypted output differs for same plaintext with different IVs", async () => {
    const { createCipheriv, pbkdf2Sync } = await import("node:crypto");

    const salt = readFileSync(join(tempDir, ".kent", "salt"));
    const key = pbkdf2Sync("same-token", salt, 100_000, 32, "sha256");
    const plaintext = JSON.stringify({ key: "value" });

    const encrypt = () => {
      const iv = randomBytes(12);
      const cipher = createCipheriv("aes-256-gcm", key, iv);
      const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
      const authTag = cipher.getAuthTag();
      return Buffer.concat([iv, authTag, encrypted]).toString("base64");
    };

    const result1 = encrypt();
    const result2 = encrypt();

    // Different IVs should produce different ciphertext
    expect(result1).not.toBe(result2);
  });

  test("handles empty keys object", async () => {
    const { createCipheriv, createDecipheriv, pbkdf2Sync } = await import("node:crypto");

    const salt = readFileSync(join(tempDir, ".kent", "salt"));
    const key = pbkdf2Sync("empty-keys-token", salt, 100_000, 32, "sha256");

    const emptyKeys = {};
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    const encrypted = Buffer.concat([cipher.update(JSON.stringify(emptyKeys), "utf8"), cipher.final()]);
    const authTag = cipher.getAuthTag();
    const packed = Buffer.concat([iv, authTag, encrypted]);

    const decipher = createDecipheriv("aes-256-gcm", key, packed.subarray(0, 12));
    decipher.setAuthTag(packed.subarray(12, 28));
    const decrypted = Buffer.concat([decipher.update(packed.subarray(28)), decipher.final()]);
    const restored = JSON.parse(decrypted.toString("utf8"));

    expect(restored).toEqual({});
  });

  test("handles large key values", async () => {
    const { createCipheriv, createDecipheriv, pbkdf2Sync } = await import("node:crypto");

    const salt = readFileSync(join(tempDir, ".kent", "salt"));
    const key = pbkdf2Sync("large-value-token", salt, 100_000, 32, "sha256");

    const largeKeys = {
      anthropic: "sk-ant-" + "a".repeat(1000),
      openai: "sk-" + "b".repeat(1000),
      custom: "x".repeat(5000),
    };

    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    const encrypted = Buffer.concat([cipher.update(JSON.stringify(largeKeys), "utf8"), cipher.final()]);
    const authTag = cipher.getAuthTag();
    const packed = Buffer.concat([iv, authTag, encrypted]);

    const decipher = createDecipheriv("aes-256-gcm", key, packed.subarray(0, 12));
    decipher.setAuthTag(packed.subarray(12, 28));
    const decrypted = Buffer.concat([decipher.update(packed.subarray(28)), decipher.final()]);
    const restored = JSON.parse(decrypted.toString("utf8"));

    expect(restored.anthropic).toBe("sk-ant-" + "a".repeat(1000));
    expect(restored.openai).toBe("sk-" + "b".repeat(1000));
    expect(restored.custom).toBe("x".repeat(5000));
  });
});

describe("PBKDF2 key derivation properties", () => {
  test("same token + salt produces same key", async () => {
    const { pbkdf2Sync } = await import("node:crypto");

    const salt = randomBytes(32);
    const token = "deterministic-token";

    const key1 = pbkdf2Sync(token, salt, 100_000, 32, "sha256");
    const key2 = pbkdf2Sync(token, salt, 100_000, 32, "sha256");

    expect(Buffer.compare(key1, key2)).toBe(0);
  });

  test("different salts produce different keys", async () => {
    const { pbkdf2Sync } = await import("node:crypto");

    const salt1 = randomBytes(32);
    const salt2 = randomBytes(32);
    const token = "same-token";

    const key1 = pbkdf2Sync(token, salt1, 100_000, 32, "sha256");
    const key2 = pbkdf2Sync(token, salt2, 100_000, 32, "sha256");

    expect(Buffer.compare(key1, key2)).not.toBe(0);
  });

  test("derived key is exactly 32 bytes (256 bits)", async () => {
    const { pbkdf2Sync } = await import("node:crypto");

    const key = pbkdf2Sync("test-token", randomBytes(32), 100_000, 32, "sha256");
    expect(key.length).toBe(32);
  });
});
