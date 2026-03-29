import { Database } from "bun:sqlite";
import { join } from "path";
import { homedir } from "os";
import { copyFileSync, existsSync, mkdirSync } from "fs";
import { tmpdir } from "os";
import type { Source, SyncState, Item } from "./types";

const NOTES_DB = join(
  homedir(),
  "Library/Group Containers/group.com.apple.notes/NoteStore.sqlite"
);
const TEMP_DIR = join(tmpdir(), "kent-notes");
const APPLE_EPOCH_OFFSET = 978307200;

export const appleNotes: Source = {
  name: "apple-notes",

  async fetchNew(state: SyncState): Promise<Item[]> {
    try {
      if (!existsSync(NOTES_DB)) {
        console.warn("[apple-notes] NoteStore.sqlite not found, skipping");
        return [];
      }

      // Copy DB to temp to avoid lock conflicts
      mkdirSync(TEMP_DIR, { recursive: true });
      const tempDb = join(TEMP_DIR, "NoteStore.sqlite");
      copyFileSync(NOTES_DB, tempDb);

      // Also copy WAL/SHM if they exist for consistency
      const walPath = NOTES_DB + "-wal";
      const shmPath = NOTES_DB + "-shm";
      if (existsSync(walPath)) {
        copyFileSync(walPath, tempDb + "-wal");
      }
      if (existsSync(shmPath)) {
        copyFileSync(shmPath, tempDb + "-shm");
      }

      const db = new Database(tempDb, { readonly: true });

      const lastSync = state.getLastSync("apple-notes");
      const lastSyncApple = lastSync > 0 ? lastSync - APPLE_EPOCH_OFFSET : 0;

      const rows = db
        .query(
          `
          SELECT
            z.Z_PK as id,
            z.ZTITLE as title,
            z.ZSNIPPET as snippet,
            z.ZMODIFICATIONDATE as modified_date,
            z.ZCREATIONDATE as creation_date,
            z.ZACCOUNT as account,
            z.ZFOLDER as folder
          FROM ZICCLOUDSYNCINGOBJECT z
          WHERE z.ZTITLE IS NOT NULL
            AND z.ZMODIFICATIONDATE > ?
          ORDER BY z.ZMODIFICATIONDATE DESC
          LIMIT 500
          `
        )
        .all(lastSyncApple) as Array<{
        id: number;
        title: string | null;
        snippet: string | null;
        modified_date: number | null;
        creation_date: number | null;
        account: number | null;
        folder: number | null;
      }>;

      db.close();

      return rows
        .filter((row) => row.title)
        .map((row) => {
          const createdAt = row.creation_date
            ? Math.floor(row.creation_date + APPLE_EPOCH_OFFSET)
            : Math.floor(Date.now() / 1000);

          return {
            source: "apple-notes",
            externalId: `apple-notes-${row.id}`,
            content: [
              row.title ? `# ${row.title}` : "",
              row.snippet || "",
            ]
              .filter(Boolean)
              .join("\n\n"),
            metadata: {
              title: row.title,
              hasSnippet: !!row.snippet,
              modifiedAt: row.modified_date
                ? Math.floor(row.modified_date + APPLE_EPOCH_OFFSET)
                : null,
              accountId: row.account,
              folderId: row.folder,
            },
            createdAt,
          };
        });
    } catch (e) {
      console.warn(`[apple-notes] Failed to read notes: ${e}`);
      return [];
    }
  },
};
