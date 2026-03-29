import { join } from "path";
import { homedir } from "os";
import { existsSync, readFileSync } from "fs";
import type { Source, SyncState, Item } from "./types";

const SIGNAL_DIR = join(
  homedir(),
  "Library/Application Support/Signal"
);
const DB_PATH = join(SIGNAL_DIR, "sql/db.sqlite");
const CONFIG_PATH = join(SIGNAL_DIR, "config.json");

export const signal: Source = {
  name: "signal",

  async fetchNew(state: SyncState): Promise<Item[]> {
    try {
      if (!existsSync(DB_PATH) || !existsSync(CONFIG_PATH)) {
        console.warn("[signal] Signal database or config not found, skipping");
        return [];
      }

      const config = JSON.parse(readFileSync(CONFIG_PATH, "utf-8"));
      const key = config.key;
      if (!key) {
        console.warn("[signal] No encryption key found in config.json");
        return [];
      }

      let BetterSqlite3: any;
      try {
        BetterSqlite3 = require("better-sqlite3-sqlcipher");
      } catch {
        console.warn(
          "[signal] better-sqlite3-sqlcipher not available, skipping Signal source"
        );
        return [];
      }

      const db = new BetterSqlite3(DB_PATH, { readonly: true });
      db.pragma(`key = "x'${key}'"`);

      const lastSync = state.getLastSync("signal");
      const lastSyncMs = lastSync > 0 ? lastSync * 1000 : 0;

      const rows = db
        .prepare(
          `
          SELECT
            id,
            json,
            sent_at,
            conversationId,
            source,
            type
          FROM messages
          WHERE sent_at > ?
          ORDER BY sent_at DESC
          LIMIT 500
          `
        )
        .all(lastSyncMs) as Array<{
        id: string;
        json: string;
        sent_at: number;
        conversationId: string;
        source: string | null;
        type: string;
      }>;

      db.close();

      return rows.map((row) => {
        let parsed: any = {};
        try {
          parsed = JSON.parse(row.json);
        } catch {}

        return {
          source: "signal",
          externalId: `signal-${row.id}`,
          content: parsed.body || "",
          metadata: {
            conversationId: row.conversationId,
            sender: row.source,
            type: row.type,
            hasAttachments: !!(
              parsed.attachments && parsed.attachments.length > 0
            ),
          },
          createdAt: Math.floor(row.sent_at / 1000),
        };
      });
    } catch (e) {
      console.warn(`[signal] Failed to read messages: ${e}`);
      return [];
    }
  },
};
