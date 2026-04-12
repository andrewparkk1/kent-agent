/**
 * Microsoft Outlook source — reads email from the local Outlook for Mac
 * SQLite database, with Microsoft Graph API as a fallback.
 *
 * Outlook for Mac stores data locally:
 *   New Outlook: ~/Library/Group Containers/UBF8T346G9.Office/Outlook/Outlook 15 Profiles/Main Profile/Data/Outlook.sqlite
 *   Legacy Outlook: ~/Library/Group Containers/UBF8T346G9.Office/Outlook/Outlook 15 Profiles/Main Profile/Data/Message Sources/
 *
 * The database is locked while Outlook runs, so we copy it to /tmp first.
 *
 * Falls back to Microsoft Graph API if a token is available via OUTLOOK_TOKEN
 * env var or ~/.kent/config.json keys.outlook.
 */
import { Database } from "bun:sqlite";
import { join } from "path";
import { homedir, tmpdir } from "os";
import { copyFileSync, existsSync, mkdirSync } from "fs";
import type { Source, SyncState, SyncOptions, Item } from "./types";
import { loadConfig } from "@shared/config.ts";

const OUTLOOK_CONTAINER = join(
  homedir(),
  "Library/Group Containers/UBF8T346G9.Office/Outlook/Outlook 15 Profiles/Main Profile/Data",
);
const OUTLOOK_DB_PATH = join(OUTLOOK_CONTAINER, "Outlook.sqlite");
const TEMP_DIR = join(tmpdir(), "kent-outlook");

// ─── Token resolution ──────────────────────────────────────────────────────

function resolveToken(): string | null {
  if (process.env.OUTLOOK_TOKEN) return process.env.OUTLOOK_TOKEN;
  try {
    const config = loadConfig();
    const token = (config.keys as any).outlook;
    if (token && typeof token === "string" && token.length > 0) return token;
  } catch {
    // config not available
  }
  return null;
}

// ─── SQLite helpers ────────────────────────────────────────────────────────

function copyToTemp(srcPath: string, name: string): string | null {
  if (!existsSync(srcPath)) return null;
  mkdirSync(TEMP_DIR, { recursive: true });
  const dest = join(TEMP_DIR, name);
  try {
    copyFileSync(srcPath, dest);
    // Also copy WAL and SHM if present for consistency
    const walPath = srcPath + "-wal";
    const shmPath = srcPath + "-shm";
    if (existsSync(walPath)) copyFileSync(walPath, dest + "-wal");
    if (existsSync(shmPath)) copyFileSync(shmPath, dest + "-shm");
    return dest;
  } catch (e) {
    console.warn(`[outlook] Failed to copy ${name} to temp: ${e}`);
    return null;
  }
}

/** Discover which table holds messages and what its columns are called. */
function discoverSchema(db: Database): {
  table: string;
  columns: {
    id: string;
    subject: string;
    sender: string;
    preview: string;
    dateReceived: string;
    hasAttachments: string | null;
    folderId: string | null;
    isRead: string | null;
    recipients: string | null;
  };
} | null {
  const tables = db
    .query("SELECT name FROM sqlite_master WHERE type='table'")
    .all() as Array<{ name: string }>;

  const tableNames = tables.map((t) => t.name);

  // Candidate table names in order of preference
  const candidates = ["Mail", "Message", "Messages", "mail", "message", "messages"];
  const messageTable = candidates.find((c) => tableNames.includes(c));

  if (!messageTable) {
    // Try to find any table that contains "mail" or "message" in its name
    const fuzzy = tableNames.find(
      (t) =>
        t.toLowerCase().includes("mail") || t.toLowerCase().includes("message"),
    );
    if (!fuzzy) return null;
    return discoverColumnsForTable(db, fuzzy);
  }

  return discoverColumnsForTable(db, messageTable);
}

function discoverColumnsForTable(
  db: Database,
  table: string,
): ReturnType<typeof discoverSchema> {
  const pragma = db
    .query(`PRAGMA table_info("${table}")`)
    .all() as Array<{ name: string }>;

  const cols = pragma.map((c) => c.name);
  const find = (...candidates: string[]): string | null =>
    candidates.find((c) => cols.includes(c)) ?? null;

  const id = find("MessageId", "Message_MessageId", "Record_RecordID", "id", "ID", "rowid");
  const subject = find("Subject", "Message_Subject", "subject");
  const sender = find("Sender", "Message_SenderList", "SenderList", "sender", "From", "from");
  const preview = find("Preview", "Body", "Message_Preview", "Message_BodyPreview", "preview", "body", "snippet");
  const dateReceived = find(
    "DateReceived",
    "Message_DateReceived",
    "Message_TimeDateReceived",
    "DateSent",
    "date_received",
    "dateReceived",
  );

  if (!id || !subject || !sender || !dateReceived) return null;

  return {
    table,
    columns: {
      id,
      subject,
      sender,
      preview: preview ?? subject, // fall back to subject if no preview column
      dateReceived,
      hasAttachments: find("HasAttachments", "Message_HasAttachment", "hasAttachments"),
      folderId: find("FolderId", "Folder_FolderId", "FolderID", "folderId", "folder_id"),
      isRead: find("IsRead", "Message_IsRead", "isRead", "is_read"),
      recipients: find("Recipients", "Message_RecipientList", "RecipientList", "To", "to"),
    },
  };
}

/** Build a folder ID -> folder name map if a Folder table exists. */
function buildFolderMap(db: Database): Map<string | number, string> {
  const map = new Map<string | number, string>();
  try {
    const tables = db
      .query("SELECT name FROM sqlite_master WHERE type='table'")
      .all() as Array<{ name: string }>;

    const folderTable = tables
      .map((t) => t.name)
      .find(
        (t) =>
          t === "Folder" ||
          t === "Folders" ||
          t.toLowerCase() === "folder" ||
          t.toLowerCase() === "folders",
      );

    if (!folderTable) return map;

    const pragma = db
      .query(`PRAGMA table_info("${folderTable}")`)
      .all() as Array<{ name: string }>;
    const cols = pragma.map((c) => c.name);

    const idCol = ["FolderId", "Folder_FolderId", "id", "ID"].find((c) => cols.includes(c));
    const nameCol = ["FolderName", "Folder_Name", "Name", "name", "DisplayName"].find((c) =>
      cols.includes(c),
    );

    if (!idCol || !nameCol) return map;

    const rows = db
      .query(`SELECT "${idCol}", "${nameCol}" FROM "${folderTable}"`)
      .all() as Array<Record<string, any>>;

    for (const row of rows) {
      map.set(row[idCol], row[nameCol] ?? "");
    }
  } catch {
    // folder table not available
  }
  return map;
}

/** Parse an Outlook date value into unix seconds. Handles both ISO strings and Cocoa timestamps. */
function parseOutlookDate(value: any): number {
  if (value == null) return Math.floor(Date.now() / 1000);

  // If it's a number, it might be a Cocoa timestamp (seconds since 2001-01-01)
  // or a Unix timestamp, or milliseconds
  if (typeof value === "number" || (typeof value === "string" && /^\d+(\.\d+)?$/.test(value))) {
    const num = Number(value);
    // Cocoa epoch: 2001-01-01T00:00:00Z = 978307200 unix seconds
    const COCOA_EPOCH = 978307200;
    // If the number is small enough to be Cocoa seconds (< 1e9 range, roughly < year 2033 in Cocoa)
    if (num > 0 && num < 1e9) {
      return Math.floor(num + COCOA_EPOCH);
    }
    // Already looks like unix seconds
    if (num > 1e9 && num < 1e11) {
      return Math.floor(num);
    }
    // Unix milliseconds
    if (num > 1e12 && num < 1e14) {
      return Math.floor(num / 1000);
    }
    // Fall through
    return Math.floor(Date.now() / 1000);
  }

  // ISO string or other parseable date
  if (typeof value === "string") {
    const ms = Date.parse(value);
    if (!isNaN(ms)) return Math.floor(ms / 1000);
  }

  return Math.floor(Date.now() / 1000);
}

/** Fetch messages from the local Outlook SQLite database. */
function fetchFromSqlite(dbPath: string, lastSync: number, options?: SyncOptions): Item[] {
  if (!existsSync(dbPath)) return [];

  // For injected test paths, skip the temp-copy step to allow fixtures
  let tempPath: string | null;
  if (dbPath === OUTLOOK_DB_PATH) {
    tempPath = copyToTemp(dbPath, "Outlook.sqlite");
  } else {
    tempPath = dbPath;
  }
  if (!tempPath) return [];

  try {
    const db = new Database(tempPath, { readonly: true });

    const schema = discoverSchema(db);
    if (!schema) {
      console.warn("[outlook] Could not discover message table/columns in Outlook.sqlite");
      db.close();
      return [];
    }

    const folderMap = buildFolderMap(db);
    const { table, columns: col } = schema;
    const limit = options?.limit ?? 1000;

    // Build column select list
    const selectCols = [
      `"${col.id}" as id`,
      `"${col.subject}" as subject`,
      `"${col.sender}" as sender`,
      `"${col.preview}" as preview`,
      `"${col.dateReceived}" as dateReceived`,
    ];
    if (col.hasAttachments) selectCols.push(`"${col.hasAttachments}" as hasAttachments`);
    if (col.folderId) selectCols.push(`"${col.folderId}" as folderId`);
    if (col.isRead) selectCols.push(`"${col.isRead}" as isRead`);
    if (col.recipients) selectCols.push(`"${col.recipients}" as recipients`);

    const query = `
      SELECT ${selectCols.join(", ")}
      FROM "${table}"
      ORDER BY "${col.dateReceived}" DESC
      LIMIT ?
    `;

    const rows = db.query(query).all(limit) as Array<Record<string, any>>;
    db.close();

    const items: Item[] = [];
    for (const row of rows) {
      const receivedAt = parseOutlookDate(row.dateReceived);

      // Skip messages older than lastSync
      if (lastSync > 0 && receivedAt <= lastSync) continue;

      const subject = (row.subject ?? "(no subject)").toString();
      const sender = (row.sender ?? "").toString();
      const preview = (row.preview ?? "").toString();
      const messageId = (row.id ?? "").toString();
      const folder = row.folderId != null ? (folderMap.get(row.folderId) ?? String(row.folderId)) : undefined;

      items.push({
        source: "outlook",
        externalId: `outlook-${messageId}`,
        content: [subject, `From: ${sender}`, preview].filter(Boolean).join("\n"),
        metadata: {
          subject,
          from: sender,
          to: row.recipients != null ? String(row.recipients) : undefined,
          receivedAt,
          hasAttachments: row.hasAttachments != null ? Boolean(row.hasAttachments) : undefined,
          folder,
          isRead: row.isRead != null ? Boolean(row.isRead) : undefined,
        },
        createdAt: receivedAt,
      });

      options?.onProgress?.(items.length);
    }

    return items;
  } catch (e) {
    console.warn(`[outlook] Failed to read Outlook.sqlite: ${e}`);
    return [];
  }
}

// ─── Microsoft Graph API fallback ──────────────────────────────────────────

async function fetchFromGraphApi(
  fetcher: typeof fetch,
  token: string,
  lastSync: number,
  options?: SyncOptions,
): Promise<Item[]> {
  const limit = options?.limit ?? 200;
  const items: Item[] = [];
  let url: string;

  if (lastSync > 0) {
    const sinceDate = new Date(lastSync * 1000).toISOString();
    url =
      `https://graph.microsoft.com/v1.0/me/messages` +
      `?$top=${limit}` +
      `&$orderby=receivedDateTime desc` +
      `&$filter=receivedDateTime ge ${sinceDate}` +
      `&$select=id,subject,from,toRecipients,receivedDateTime,bodyPreview,hasAttachments,isRead,parentFolderId`;
  } else {
    url =
      `https://graph.microsoft.com/v1.0/me/messages` +
      `?$top=${limit}` +
      `&$orderby=receivedDateTime desc` +
      `&$select=id,subject,from,toRecipients,receivedDateTime,bodyPreview,hasAttachments,isRead,parentFolderId`;
  }

  let pageCount = 0;
  const maxPages = 5;

  while (url && pageCount < maxPages) {
    const res = await fetcher(url, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!res.ok) {
      const text = await res.text();
      console.warn(`[outlook] Graph API error ${res.status}: ${text.slice(0, 200)}`);
      break;
    }

    const data = (await res.json()) as any;
    const messages: any[] = data.value ?? [];

    for (const msg of messages) {
      const receivedAt = msg.receivedDateTime
        ? Math.floor(new Date(msg.receivedDateTime).getTime() / 1000)
        : Math.floor(Date.now() / 1000);

      const subject = msg.subject ?? "(no subject)";
      const sender =
        msg.from?.emailAddress?.name ??
        msg.from?.emailAddress?.address ??
        "";
      const to = (msg.toRecipients ?? [])
        .map(
          (r: any) =>
            r.emailAddress?.name ?? r.emailAddress?.address ?? "",
        )
        .filter(Boolean)
        .join(", ");

      const preview = msg.bodyPreview ?? "";

      items.push({
        source: "outlook",
        externalId: `outlook-${msg.id}`,
        content: [subject, `From: ${sender}`, preview].filter(Boolean).join("\n"),
        metadata: {
          subject,
          from: sender,
          to: to || undefined,
          receivedAt,
          hasAttachments: msg.hasAttachments ?? false,
          folder: msg.parentFolderId,
          isRead: msg.isRead ?? undefined,
        },
        createdAt: receivedAt,
      });
    }

    options?.onProgress?.(items.length);

    // Follow @odata.nextLink for pagination
    url = data["@odata.nextLink"] ?? null;
    pageCount++;

    if (items.length >= limit) break;
  }

  return items;
}

// ─── Exported source ───────────────────────────────────────────────────────

export function createOutlookSource(
  config: {
    dbPath?: string;
    fetcher?: typeof fetch;
    token?: string | null;
  } = {},
): Source {
  const dbPath = config.dbPath ?? OUTLOOK_DB_PATH;
  const fetcher = config.fetcher ?? fetch;
  const getToken = () =>
    config.token !== undefined ? config.token : resolveToken();

  return {
    name: "outlook",

    async fetchNew(state: SyncState, options?: SyncOptions): Promise<Item[]> {
      try {
        const lastSync = state.getLastSync("outlook");

        // 1. Try local SQLite database first
        const sqliteItems = fetchFromSqlite(dbPath, lastSync, options);
        if (sqliteItems.length > 0) return sqliteItems;

        // 2. Fall back to Microsoft Graph API if token is available
        const token = getToken();
        if (token) {
          return await fetchFromGraphApi(fetcher, token, lastSync, options);
        }

        // No data source available
        console.warn(
          "[outlook] No local Outlook database found and no OUTLOOK_TOKEN configured, skipping",
        );
        return [];
      } catch (e) {
        console.warn(`[outlook] Failed to fetch data: ${e}`);
        return [];
      }
    },
  };
}

export const outlook: Source = createOutlookSource();
