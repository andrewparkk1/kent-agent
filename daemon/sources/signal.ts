/**
 * Signal Desktop chat history — reads the local encrypted SQLite database.
 *
 * Signal Desktop stores messages in a SQLCipher-encrypted database at:
 *   ~/Library/Application Support/Signal/sql/db.sqlite
 *
 * The encryption key is stored in config.json as `encryptedKey`, encrypted
 * via Electron's safeStorage API (backed by macOS Keychain).
 *
 * To decrypt: we use the `security` CLI to extract the Keychain password,
 * then decrypt the key using Chromium os_crypt (PBKDF2 + AES-128-CBC).
 *
 * Since better-sqlite3 native addons don't work in Bun, we shell out to
 * the `sqlcipher` CLI (brew install sqlcipher) to query the database.
 *
 * Falls back gracefully if Signal is not installed or key is inaccessible.
 */
import { join } from "path";
import { homedir, tmpdir } from "os";
import {
  existsSync,
  readFileSync,
  copyFileSync,
  mkdirSync,
} from "fs";
import { execFileSync } from "child_process";
import { pbkdf2Sync, createDecipheriv } from "crypto";
import type { Source, SyncState, SyncOptions, Item } from "./types";

const SIGNAL_BASE = join(homedir(), "Library/Application Support/Signal");
const SIGNAL_DB = join(SIGNAL_BASE, "sql/db.sqlite");
const SIGNAL_CONFIG = join(SIGNAL_BASE, "config.json");
const TEMP_DIR = join(tmpdir(), "kent-signal");

// Ensure brew-installed CLIs are discoverable
const CLI_PATH = ["/opt/homebrew/bin", "/usr/local/bin", process.env.PATH ?? ""].join(":");

/**
 * Get the decrypted Signal SQLCipher key.
 */
function getSignalKey(): string | null {
  try {
    if (!existsSync(SIGNAL_CONFIG)) return null;

    const config = JSON.parse(readFileSync(SIGNAL_CONFIG, "utf-8"));
    const encryptedKeyHex = config.encryptedKey;
    if (!encryptedKeyHex) {
      console.warn("[signal] No encryptedKey in config.json");
      return null;
    }

    // Get Keychain password for Signal Safe Storage
    let keychainPassword: string;
    try {
      keychainPassword = execFileSync("security", [
        "find-generic-password",
        "-s",
        "Signal Safe Storage",
        "-w",
      ], { encoding: "utf-8" }).trim();
    } catch {
      console.warn(
        "[signal] Cannot access Signal Keychain entry — grant access in Keychain Access.app"
      );
      return null;
    }

    // Chromium os_crypt: "v10" prefix + AES-128-CBC with PBKDF2 derived key
    const encryptedBuf = Buffer.from(encryptedKeyHex, "hex");
    const prefix = encryptedBuf.slice(0, 3).toString("utf-8");

    if (prefix === "v10" || prefix === "v11") {
      const derivedKey = pbkdf2Sync(
        keychainPassword,
        "saltysalt",
        1003,
        16,
        "sha1"
      );
      const iv = Buffer.alloc(16, " ");
      const ciphertext = encryptedBuf.slice(3);
      const decipher = createDecipheriv("aes-128-cbc", derivedKey, iv);
      let decrypted = decipher.update(ciphertext);
      decrypted = Buffer.concat([decrypted, decipher.final()]);
      return decrypted.toString("utf-8");
    }

    console.warn(`[signal] Unknown encryption format: ${prefix}`);
    return null;
  } catch (e) {
    console.warn(`[signal] Failed to get key: ${e}`);
    return null;
  }
}

/**
 * Query Signal's encrypted database via the sqlcipher CLI.
 * Returns parsed JSON rows or null on failure.
 */
function querySignalDb(sql: string): any[] | null {
  const key = getSignalKey();
  if (!key) return null;

  // Copy DB to temp to avoid WAL lock contention
  mkdirSync(TEMP_DIR, { recursive: true });
  const tmpDb = join(TEMP_DIR, "db.sqlite");
  try {
    copyFileSync(SIGNAL_DB, tmpDb);
    if (existsSync(SIGNAL_DB + "-wal"))
      copyFileSync(SIGNAL_DB + "-wal", tmpDb + "-wal");
    if (existsSync(SIGNAL_DB + "-shm"))
      copyFileSync(SIGNAL_DB + "-shm", tmpDb + "-shm");
  } catch (e) {
    console.warn(`[signal] Failed to copy database: ${e}`);
    return null;
  }

  try {
    // sqlcipher CLI commands: set key, set JSON output mode, run query
    const commands = [
      `PRAGMA key="x'${key}'";`,
      `.mode json`,
      sql,
    ].join("\n");

    const result = execFileSync("sqlcipher", [tmpDb], {
      input: commands,
      encoding: "utf-8",
      timeout: 30_000,
      maxBuffer: 10 * 1024 * 1024,
      env: { ...process.env, PATH: CLI_PATH },
    });

    const trimmed = result.trim();
    if (!trimmed) return [];
    // sqlcipher may output "ok" or other non-JSON lines from PRAGMA commands.
    // Find the first '[' which starts the JSON array.
    const jsonStart = trimmed.indexOf('[');
    if (jsonStart === -1) return [];
    return JSON.parse(trimmed.slice(jsonStart));
  } catch (e) {
    console.warn(`[signal] sqlcipher query failed: ${e}`);
    return null;
  }
}

export const signal: Source = {
  name: "signal",

  async fetchNew(state: SyncState, options?: SyncOptions): Promise<Item[]> {
    try {
      if (!existsSync(SIGNAL_DB)) {
        console.warn("[signal] Signal database not found, skipping");
        return [];
      }

      // Check sqlcipher CLI is available
      try {
        execFileSync("which", ["sqlcipher"], {
          encoding: "utf-8",
          env: { ...process.env, PATH: CLI_PATH },
        });
      } catch {
        console.warn(
          "[signal] sqlcipher CLI not found. Install with: brew install sqlcipher"
        );
        return [];
      }

      const lastSync = state.getLastSync("signal");
      const lastSyncMs = lastSync > 0 ? lastSync * 1000 : 0;

      const rows = querySignalDb(`
        SELECT
          m.rowid,
          m.body,
          m.type,
          m.sent_at,
          m.received_at,
          m.conversationId,
          c.name as conv_name,
          c.profileName,
          c.profileFullName,
          c.e164,
          c.type as conv_type
        FROM messages m
        LEFT JOIN conversations c ON m.conversationId = c.id
        WHERE m.sent_at > ${lastSyncMs}
          AND m.body IS NOT NULL AND m.body != ''
        ORDER BY m.sent_at DESC
        LIMIT ${options?.limit ?? 10000};
      `);

      if (!rows) {
        console.warn("[signal] Failed to query database");
        return [];
      }

      return rows.map((row: any) => {
        const text = row.body || "";
        const isGroup = row.conv_type === "group";
        const contactName =
          row.conv_name ||
          row.profileFullName ||
          row.profileName ||
          row.e164 ||
          "Unknown";
        const timestamp = row.sent_at || row.received_at;

        return {
          source: "signal",
          externalId: `signal-${row.rowid}`,
          content: text,
          metadata: {
            conversationId: row.conversationId || "unknown",
            contactName,
            isFromMe: row.type === "outgoing",
            isGroup,
          },
          createdAt: Math.floor(timestamp / 1000),
        };
      });
    } catch (e) {
      console.warn(`[signal] Failed to read messages: ${e}`);
      return [];
    }
  },
};
