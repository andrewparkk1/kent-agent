import {
  createCipheriv,
  createDecipheriv,
  pbkdf2Sync,
  randomBytes,
} from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const KENT_DIR = join(homedir(), ".kent");
const SALT_PATH = join(KENT_DIR, "salt");
const PBKDF2_ITERATIONS = 100_000;
const KEY_LENGTH = 32; // 256-bit AES key
const IV_LENGTH = 12; // 96-bit IV for GCM
const AUTH_TAG_LENGTH = 16;
const ALGORITHM = "aes-256-gcm";

export class KeyVault {
  private deviceToken: string;

  constructor(deviceToken: string) {
    this.deviceToken = deviceToken;
  }

  /**
   * Derive a 32-byte AES-256 key from the device token using PBKDF2.
   * Salt is stored in ~/.kent/salt and created on first use.
   */
  private deriveKey(): Buffer {
    const salt = this.getSalt();
    return pbkdf2Sync(
      this.deviceToken,
      salt,
      PBKDF2_ITERATIONS,
      KEY_LENGTH,
      "sha256"
    );
  }

  /**
   * Get or create the salt file at ~/.kent/salt.
   */
  private getSalt(): Buffer {
    if (!existsSync(KENT_DIR)) {
      mkdirSync(KENT_DIR, { recursive: true });
    }

    if (existsSync(SALT_PATH)) {
      return readFileSync(SALT_PATH);
    }

    // Generate a new 32-byte salt
    const salt = randomBytes(32);
    writeFileSync(SALT_PATH, salt, { mode: 0o600 });
    return salt;
  }

  /**
   * Encrypt a keys object using AES-256-GCM.
   * Returns base64(iv + authTag + ciphertext).
   */
  encryptKeys(keys: Record<string, string>): string {
    const key = this.deriveKey();
    const iv = randomBytes(IV_LENGTH);
    const cipher = createCipheriv(ALGORITHM, key, iv);

    const plaintext = JSON.stringify(keys);
    const encrypted = Buffer.concat([
      cipher.update(plaintext, "utf8"),
      cipher.final(),
    ]);
    const authTag = cipher.getAuthTag();

    // Pack: iv (12) + authTag (16) + ciphertext (variable)
    const packed = Buffer.concat([iv, authTag, encrypted]);
    return packed.toString("base64");
  }

  /**
   * Decrypt a base64-encoded encrypted blob back to a keys object.
   * Expects base64(iv[12] + authTag[16] + ciphertext).
   */
  decryptKeys(encrypted: string): Record<string, string> {
    const key = this.deriveKey();
    const packed = Buffer.from(encrypted, "base64");

    const iv = packed.subarray(0, IV_LENGTH);
    const authTag = packed.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
    const ciphertext = packed.subarray(IV_LENGTH + AUTH_TAG_LENGTH);

    const decipher = createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);

    const decrypted = Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]);

    return JSON.parse(decrypted.toString("utf8"));
  }

  /**
   * Encrypt keys and push to Convex via the saveKeys mutation.
   * @param convexClient - A Convex client instance (ConvexHttpClient or similar)
   * @param keys - The API keys to encrypt and store
   */
  async pushToConvex(
    convexClient: { mutation: (fn: any, args: any) => Promise<any> },
    keys: Record<string, string>
  ): Promise<void> {
    const encryptedBlob = this.encryptKeys(keys);

    // Dynamic import to avoid hard dependency on convex at module level
    const { api } = await import("../backend/convex/_generated/api");

    await convexClient.mutation(api.keys.saveKeys, {
      deviceToken: this.deviceToken,
      encryptedBlob,
    });
  }

  /**
   * Fetch encrypted keys from Convex and decrypt them.
   * @param convexClient - A Convex client instance
   */
  async pullFromConvex(
    convexClient: { query: (fn: any, args: any) => Promise<any> }
  ): Promise<Record<string, string> | null> {
    const { api } = await import("../backend/convex/_generated/api");

    const result = await convexClient.query(api.keys.getKeys, {
      deviceToken: this.deviceToken,
    });

    if (!result.encryptedBlob) {
      return null;
    }

    return this.decryptKeys(result.encryptedBlob);
  }
}
