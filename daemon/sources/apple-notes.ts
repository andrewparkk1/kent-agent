/**
 * Apple Notes — reads the local Notes database.
 *
 * macOS stores Apple Notes data in a SQLite database at:
 *   ~/Library/Group Containers/group.com.apple.notes/NoteStore.sqlite
 *
 * The database uses Core Data conventions (ZICCLOUDSYNCINGOBJECT table).
 * Note bodies are gzip-compressed protobuf in ZICNOTEDATA.ZDATA;
 * we decompress and parse the protobuf to extract the actual text.
 *
 * Apple Core Data timestamps: seconds since 2001-01-01 (same epoch as NSDate).
 */
import { Database } from "bun:sqlite";
import { join } from "path";
import { homedir, tmpdir } from "os";
import { copyFileSync, existsSync, mkdirSync } from "fs";
import { gunzipSync } from "zlib";
import type { Source, SyncState, Item } from "./types";

const NOTES_DB = join(
  homedir(),
  "Library/Group Containers/group.com.apple.notes/NoteStore.sqlite"
);
const TEMP_DIR = join(tmpdir(), "kent-notes");

/** Apple Core Data epoch offset: seconds between 2001-01-01 and 1970-01-01 */
const CORE_DATA_EPOCH_OFFSET = 978307200;

/** Convert Core Data timestamp (seconds since 2001-01-01) to JS Date */
function coreDataToDate(ts: number | null): Date | null {
  if (!ts) return null;
  return new Date((ts + CORE_DATA_EPOCH_OFFSET) * 1000);
}

// ---------------------------------------------------------------------------
// Protobuf text extraction (ported from kent)
// ---------------------------------------------------------------------------

/**
 * Extract note text from gzip-compressed protobuf data.
 * Apple Notes stores the body as: gzip → protobuf → nested string fields.
 */
function extractNoteText(data: Buffer | Uint8Array): string | null {
  try {
    const buf = gunzipSync(data);
    const strings = extractProtobufStrings(Buffer.from(buf));

    // Filter out protobuf metadata / framework noise
    const meaningful = strings.filter((s) => {
      const trimmed = s.trim();
      if (trimmed.length < 2) return false;
      // Single PascalCase words are typically protobuf field names
      if (/^[A-Z][a-z]+$/.test(trimmed)) return false;
      // Apple framework prefixes
      if (trimmed.startsWith("NS") && /^NS[A-Z]/.test(trimmed)) return false;
      // Pure whitespace
      if (!trimmed) return false;
      // Very short strings that are just punctuation/symbols
      if (trimmed.length <= 3 && !/[a-zA-Z0-9]/.test(trimmed)) return false;
      return true;
    });

    return meaningful.join("\n").trim() || null;
  } catch {
    return null;
  }
}

/**
 * Minimal protobuf wire-format parser that extracts only length-delimited
 * string fields (wire type 2). Avoids interpreting binary varint/fixed
 * data as text, which causes gibberish output.
 */
function extractProtobufStrings(buf: Buffer): string[] {
  const results: string[] = [];
  let i = 0;

  while (i < buf.length) {
    // Read field tag (varint)
    const tagResult = readVarint(buf, i);
    if (!tagResult) break;
    const [tag, tagEnd] = tagResult;
    i = tagEnd;

    const wireType = tag & 0x07;

    switch (wireType) {
      case 0: {
        // Varint — skip it
        const skip = readVarint(buf, i);
        if (!skip) return results;
        i = skip[1];
        break;
      }
      case 1: {
        // 64-bit fixed — skip 8 bytes
        i += 8;
        break;
      }
      case 2: {
        // Length-delimited (string, bytes, or embedded message)
        const lenResult = readVarint(buf, i);
        if (!lenResult) return results;
        const [len, lenEnd] = lenResult;
        i = lenEnd;
        if (i + len > buf.length) return results;

        const slice = buf.slice(i, i + len);
        i += len;

        // Try to decode as UTF-8 text
        try {
          const text = new TextDecoder("utf-8", { fatal: true }).decode(slice);
          // Check if it looks like real text (mostly printable chars)
          const printable = text.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, "");
          if (printable.length > text.length * 0.8 && text.length >= 1) {
            results.push(printable);
          }
        } catch {
          // Not valid UTF-8 — might be an embedded message, try recursing
          const nested = extractProtobufStrings(slice);
          results.push(...nested);
        }
        break;
      }
      case 5: {
        // 32-bit fixed — skip 4 bytes
        i += 4;
        break;
      }
      default:
        // Unknown wire type — can't continue safely
        return results;
    }
  }

  return results;
}

/** Read a protobuf varint from buf at offset. Returns [value, newOffset] or null. */
function readVarint(buf: Buffer, offset: number): [number, number] | null {
  let result = 0;
  let shift = 0;
  let i = offset;
  while (i < buf.length) {
    const byte = buf[i];
    result |= (byte & 0x7f) << shift;
    i++;
    if ((byte & 0x80) === 0) return [result, i];
    shift += 7;
    if (shift > 35) return null; // Too many bytes for a 32-bit varint
  }
  return null;
}

// ---------------------------------------------------------------------------
// Source implementation
// ---------------------------------------------------------------------------

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
      const lastSyncCoreData = lastSync > 0
        ? (lastSync / 1000) - CORE_DATA_EPOCH_OFFSET
        : 0;

      const rows = db
        .query(
          `
          SELECT
            n.Z_PK as id,
            n.ZTITLE1 as title,
            n.ZSNIPPET as snippet,
            n.ZMODIFICATIONDATE1 as modified,
            n.ZCREATIONDATE3 as created,
            f.ZTITLE2 as folder,
            nd.ZDATA as body_data
          FROM ZICCLOUDSYNCINGOBJECT n
          LEFT JOIN ZICCLOUDSYNCINGOBJECT f ON n.ZFOLDER = f.Z_PK
          LEFT JOIN ZICNOTEDATA nd ON nd.ZNOTE = n.Z_PK
          WHERE n.ZTITLE1 IS NOT NULL
            AND (n.ZMARKEDFORDELETION IS NULL OR n.ZMARKEDFORDELETION = 0)
            AND (n.ZISPASSWORDPROTECTED IS NULL OR n.ZISPASSWORDPROTECTED = 0)
            AND n.ZMODIFICATIONDATE1 > ?
          ORDER BY n.ZMODIFICATIONDATE1 DESC
          LIMIT 500
          `
        )
        .all(lastSyncCoreData) as Array<{
        id: number;
        title: string | null;
        snippet: string | null;
        modified: number | null;
        created: number | null;
        folder: string | null;
        body_data: Buffer | Uint8Array | null;
      }>;

      db.close();

      return rows
        .filter((row) => row.title)
        .map((row) => {
          const title = row.title || "Untitled";
          const snippet = row.snippet || "";
          const folder = row.folder || "Notes";

          // Extract full body text from gzip+protobuf
          let body: string | null = null;
          if (row.body_data) {
            body = extractNoteText(
              row.body_data instanceof Buffer
                ? row.body_data
                : Buffer.from(row.body_data)
            );
          }

          const modifiedDate = coreDataToDate(row.modified);
          const createdDate = coreDataToDate(row.created);

          // Use body for content, fall back to snippet
          const textContent = body || snippet;
          const content = [
            `# ${title}`,
            folder !== "Notes" ? `Folder: ${folder}` : "",
            textContent,
          ]
            .filter(Boolean)
            .join("\n\n");

          const createdAt = createdDate
            ? Math.floor(createdDate.getTime() / 1000)
            : Math.floor(Date.now() / 1000);

          return {
            source: "apple-notes",
            externalId: `apple-notes-${row.id}`,
            content,
            metadata: {
              title,
              folder,
              hasBody: !!body,
              wordCount: (textContent || "").split(/\s+/).filter(Boolean).length,
              modifiedAt: modifiedDate
                ? Math.floor(modifiedDate.getTime() / 1000)
                : null,
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
