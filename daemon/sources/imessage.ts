import { Database } from "bun:sqlite";
import { join } from "path";
import { homedir } from "os";
import type { Source, SyncState, Item } from "./types";

const APPLE_EPOCH_OFFSET = 978307200;
const DB_PATH = join(homedir(), "Library/Messages/chat.db");

export const imessage: Source = {
  name: "imessage",

  async fetchNew(state: SyncState): Promise<Item[]> {
    try {
      const lastSync = state.getLastSync("imessage");
      const lastSyncApple = lastSync > 0 ? lastSync - APPLE_EPOCH_OFFSET : 0;

      const db = new Database(DB_PATH, { readonly: true });

      const rows = db
        .query(
          `
          SELECT
            m.ROWID as id,
            m.text,
            m.date / 1000000000 as date_seconds,
            m.is_from_me,
            m.service,
            h.id as handle_id,
            c.display_name as chat_name,
            c.chat_identifier
          FROM message m
          LEFT JOIN handle h ON m.handle_id = h.ROWID
          LEFT JOIN chat_message_join cmj ON m.ROWID = cmj.message_id
          LEFT JOIN chat c ON cmj.chat_id = c.ROWID
          WHERE m.date / 1000000000 > ?
          ORDER BY m.date DESC
          LIMIT 500
          `
        )
        .all(lastSyncApple) as Array<{
        id: number;
        text: string | null;
        date_seconds: number;
        is_from_me: number;
        service: string;
        handle_id: string | null;
        chat_name: string | null;
        chat_identifier: string | null;
      }>;

      db.close();

      return rows
        .filter((row) => row.text)
        .map((row) => ({
          source: "imessage",
          externalId: `imessage-${row.id}`,
          content: row.text!,
          metadata: {
            isFromMe: row.is_from_me === 1,
            service: row.service,
            handle: row.handle_id,
            chatName: row.chat_name,
            chatIdentifier: row.chat_identifier,
          },
          createdAt: row.date_seconds + APPLE_EPOCH_OFFSET,
        }));
    } catch (e) {
      console.warn(`[imessage] Failed to read messages: ${e}`);
      return [];
    }
  },
};
