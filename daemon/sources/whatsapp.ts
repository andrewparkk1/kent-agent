/**
 * WhatsApp Desktop chat history — reads the local WhatsApp SQLite database.
 *
 * WhatsApp Desktop stores data at:
 *   ~/Library/Group Containers/group.net.whatsapp.WhatsApp.shared/
 *
 * The main chat database is at:
 *   ~/Library/Group Containers/group.net.whatsapp.WhatsApp.shared/ChatStorage.sqlite
 *
 * Key tables (Core Data schema):
 *   ZWAMESSAGE — messages with ZTEXT, ZMESSAGEDATE, ZISFROMME, ZSTANZAID, ZMESSAGETYPE
 *   ZWACHATSESSION — chats with ZCONTACTJID, ZPARTNERNAME, ZLASTMESSAGEDATE
 *   Messages link to chats via the ZCHATSESSION FK on ZWAMESSAGE.
 *
 * Core Data timestamp: seconds since 2001-01-01 (offset 978307200 to Unix).
 *
 * The database may be locked while WhatsApp is running, so we copy it to
 * a temp location first (same approach as the Chrome source).
 */
import { Database } from "bun:sqlite";
import { join } from "path";
import { homedir, tmpdir } from "os";
import { copyFileSync, existsSync, mkdirSync } from "fs";
import type { Source, SyncState, SyncOptions, Item } from "./types";

const CORE_DATA_EPOCH_OFFSET = 978307200;

const DEFAULT_WHATSAPP_DB = join(
  homedir(),
  "Library/Group Containers/group.net.whatsapp.WhatsApp.shared/ChatStorage.sqlite"
);

const DEFAULT_TEMP_DIR = join(tmpdir(), "kent-whatsapp");

/** Convert Core Data timestamp (seconds since 2001-01-01) to Unix seconds. */
function coreDataTimeToUnix(coreDataTime: number): number {
  return Math.floor(coreDataTime + CORE_DATA_EPOCH_OFFSET);
}

/** Copy the WhatsApp DB (and WAL/SHM if present) to a temp directory. */
function copyDbToTemp(srcDb: string, tempDir: string): string | null {
  if (!existsSync(srcDb)) return null;

  mkdirSync(tempDir, { recursive: true });
  const dest = join(tempDir, "ChatStorage.sqlite");

  try {
    copyFileSync(srcDb, dest);
    // Copy WAL and SHM files if they exist for consistency
    if (existsSync(srcDb + "-wal"))
      copyFileSync(srcDb + "-wal", dest + "-wal");
    if (existsSync(srcDb + "-shm"))
      copyFileSync(srcDb + "-shm", dest + "-shm");
    return dest;
  } catch (e) {
    console.warn(`[whatsapp] Failed to copy database to temp: ${e}`);
    return null;
  }
}

export interface WhatsappSourceConfig {
  dbPath?: string;
  tempDir?: string;
  /** If true, skip the copy-to-temp step and open dbPath directly. Useful for tests. */
  skipCopy?: boolean;
  now?: () => number;
}

export function createWhatsappSource(config: WhatsappSourceConfig = {}): Source {
  const dbPath = config.dbPath ?? DEFAULT_WHATSAPP_DB;
  const tempDir = config.tempDir ?? DEFAULT_TEMP_DIR;
  const skipCopy = config.skipCopy ?? false;
  const now = config.now ?? (() => Math.floor(Date.now() / 1000));

  return {
    name: "whatsapp",

    async fetchNew(state: SyncState, options?: SyncOptions): Promise<Item[]> {
    try {
      if (!existsSync(dbPath)) {
        console.warn("[whatsapp] ChatStorage.sqlite not found, skipping");
        return [];
      }

      const tmpDbPath = skipCopy ? dbPath : copyDbToTemp(dbPath, tempDir);
      if (!tmpDbPath) return [];

      // Open without readonly: WAL-mode databases need a -shm sidecar which
      // can't be created in readonly mode. The temp copy is safe to open r/w.
      const db = new Database(tmpDbPath);
      const limit = options?.limit ?? 10000;

      const lastSync = state.getLastSync("whatsapp");
      let cutoffCoreData: number;
      if (lastSync > 0) {
        cutoffCoreData = lastSync - CORE_DATA_EPOCH_OFFSET;
      } else if (options?.defaultDays && options.defaultDays > 0) {
        const cutoffUnix = now() - options.defaultDays * 86400;
        cutoffCoreData = cutoffUnix - CORE_DATA_EPOCH_OFFSET;
      } else {
        cutoffCoreData = 0;
      }

      const rows = db
        .query(
          `
          SELECT
            m.Z_PK,
            m.ZSTANZAID,
            m.ZTEXT,
            m.ZMESSAGEDATE,
            m.ZISFROMME,
            m.ZMESSAGETYPE,
            c.ZCONTACTJID,
            c.ZPARTNERNAME
          FROM ZWAMESSAGE m
          LEFT JOIN ZWACHATSESSION c ON m.ZCHATSESSION = c.Z_PK
          WHERE m.ZMESSAGEDATE > ?
            AND m.ZTEXT IS NOT NULL
            AND m.ZTEXT != ''
          ORDER BY m.ZMESSAGEDATE DESC
          LIMIT ${limit}
          `
        )
        .all(cutoffCoreData) as Array<{
        Z_PK: number;
        ZSTANZAID: string | null;
        ZTEXT: string;
        ZMESSAGEDATE: number;
        ZISFROMME: number;
        ZMESSAGETYPE: number;
        ZCONTACTJID: string | null;
        ZPARTNERNAME: string | null;
      }>;

      db.close();

      const items: Item[] = [];
      for (const row of rows) {
        const text = row.ZTEXT;
        if (!text) continue;

        const externalId = `whatsapp-${row.ZSTANZAID || row.Z_PK}`;
        const isFromMe = row.ZISFROMME === 1;
        const contactName = row.ZPARTNERNAME || row.ZCONTACTJID || "Unknown";
        const conversationId = row.ZCONTACTJID || "unknown";
        // Group JIDs end with @g.us, individual chats end with @s.whatsapp.net
        const isGroup = conversationId.endsWith("@g.us");
        const createdAt = coreDataTimeToUnix(row.ZMESSAGEDATE);

        items.push({
          source: "whatsapp",
          externalId,
          content: text,
          metadata: {
            isFromMe,
            contactName,
            isGroup,
            conversationId,
          },
          createdAt,
        });

        if (options?.onProgress && items.length % 500 === 0) {
          options.onProgress(items.length);
        }
      }

      return items;
    } catch (e) {
      console.warn(`[whatsapp] Failed to read messages: ${e}`);
      return [];
    }
    },
  };
}

export const whatsapp: Source = createWhatsappSource();
