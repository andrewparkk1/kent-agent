/**
 * iMessage history — reads the local Messages database.
 *
 * macOS stores iMessage/SMS data in a SQLite database at:
 *   ~/Library/Messages/chat.db
 *
 * The database is readable while Messages.app runs (WAL mode).
 * Apple epoch: nanoseconds since 2001-01-01.
 *   Convert to Unix: unix_seconds = (date / 1_000_000_000) + 978307200
 */
import { Database } from "bun:sqlite";
import { join } from "path";
import { homedir } from "os";
import { existsSync, readdirSync } from "fs";
import type { Source, SyncState, Item } from "./types";

const APPLE_EPOCH_OFFSET = 978307200;
const DB_PATH = join(homedir(), "Library/Messages/chat.db");

// --- Contact Resolution ---

const CONTACTS_DB_SOURCES = join(
  homedir(),
  "Library/Application Support/AddressBook/Sources"
);
const CONTACTS_DB_MAIN = join(
  homedir(),
  "Library/Application Support/AddressBook/AddressBook-v22.abcddb"
);

let contactCache: Map<string, string> | null = null;

/** Normalize a phone number to digits only (strip +, spaces, parens, dashes) */
function normalizePhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("1")) return digits.slice(1);
  return digits;
}

/** Build a lookup map from phone/email → contact name */
function buildContactCache(): Map<string, string> {
  if (contactCache) return contactCache;
  contactCache = new Map<string, string>();

  const dbPaths: string[] = [];
  if (existsSync(CONTACTS_DB_MAIN)) dbPaths.push(CONTACTS_DB_MAIN);
  try {
    if (existsSync(CONTACTS_DB_SOURCES)) {
      const sources = readdirSync(CONTACTS_DB_SOURCES);
      for (const src of sources) {
        const srcDb = join(CONTACTS_DB_SOURCES, src, "AddressBook-v22.abcddb");
        if (existsSync(srcDb)) dbPaths.push(srcDb);
      }
    }
  } catch {
    /* ignore */
  }

  for (const dbPath of dbPaths) {
    try {
      const db = new Database(dbPath, { readonly: true });
      try {
        // Phone numbers
        const phones = db
          .query(
            `SELECT r.ZFIRSTNAME, r.ZLASTNAME, p.ZFULLNUMBER
           FROM ZABCDRECORD r
           JOIN ZABCDPHONENUMBER p ON p.ZOWNER = r.Z_PK
           WHERE r.ZFIRSTNAME IS NOT NULL AND p.ZFULLNUMBER IS NOT NULL`
          )
          .all() as any[];

        for (const row of phones) {
          const name = [row.ZFIRSTNAME, row.ZLASTNAME]
            .filter(Boolean)
            .join(" ");
          if (name && row.ZFULLNUMBER) {
            contactCache.set(normalizePhone(row.ZFULLNUMBER), name);
          }
        }

        // Email addresses
        const emails = db
          .query(
            `SELECT r.ZFIRSTNAME, r.ZLASTNAME, e.ZADDRESS
           FROM ZABCDRECORD r
           JOIN ZABCDEMAILADDRESS e ON e.ZOWNER = r.Z_PK
           WHERE r.ZFIRSTNAME IS NOT NULL AND e.ZADDRESS IS NOT NULL`
          )
          .all() as any[];

        for (const row of emails) {
          const name = [row.ZFIRSTNAME, row.ZLASTNAME]
            .filter(Boolean)
            .join(" ");
          if (name && row.ZADDRESS) {
            contactCache.set(row.ZADDRESS.toLowerCase(), name);
          }
        }
      } finally {
        db.close();
      }
    } catch {
      // ignore — AddressBook may not be accessible
    }
  }

  return contactCache;
}

/** Resolve a phone number or email to a contact name */
function resolveContact(identifier: string): string | null {
  const cache = buildContactCache();

  // Try direct email lookup
  const byEmail = cache.get(identifier.toLowerCase());
  if (byEmail) return byEmail;

  // Try phone number lookup
  const normalized = normalizePhone(identifier);
  if (normalized.length >= 7) {
    const byPhone = cache.get(normalized);
    if (byPhone) return byPhone;

    // Try matching last 10 digits (handles country code differences)
    const last10 = normalized.slice(-10);
    for (const [key, name] of cache) {
      if (key.slice(-10) === last10) return name;
    }
  }

  return null;
}

/** Convert Apple Messages timestamp (nanoseconds since 2001-01-01) to unix seconds */
function appleTimeToUnix(appleTime: number): number {
  // Some older messages use seconds instead of nanoseconds
  // Nanosecond timestamps are > 1e17, second timestamps are < 1e10
  const unixSeconds =
    appleTime > 1e17
      ? appleTime / 1_000_000_000 + APPLE_EPOCH_OFFSET
      : appleTime + APPLE_EPOCH_OFFSET;
  return Math.floor(unixSeconds);
}

/**
 * Extract text from attributedBody (NSKeyedArchiver binary format).
 * When plain text field is empty, iMessage sometimes stores formatted
 * text only in attributedBody.
 */
function extractFromAttributedBody(buf: Buffer | Uint8Array): string | null {
  try {
    const b = buf instanceof Buffer ? buf : Buffer.from(buf);
    if (b.length === 0) return null;
    const nsIdx = b.indexOf("NSString");
    if (nsIdx === -1) return null;

    let pos = nsIdx + 8;
    // Skip marker bytes until we hit 0x2b ('+')
    while (pos < b.length && b[pos] !== 0x2b) pos++;
    if (pos < b.length - 1 && b[pos] === 0x2b) {
      pos++; // skip '+'
      const len = b[pos]; // string length
      pos++;
      if (len > 0 && pos + len <= b.length) {
        return b.slice(pos, pos + len).toString("utf-8");
      }
    }
  } catch {
    // ignore extraction failures
  }
  return null;
}

export const imessage: Source = {
  name: "imessage",

  async fetchNew(state: SyncState): Promise<Item[]> {
    try {
      if (!existsSync(DB_PATH)) {
        console.warn("[imessage] chat.db not found, skipping");
        return [];
      }

      const db = new Database(DB_PATH, { readonly: true });

      const lastSync = state.getLastSync("imessage");
      // Convert lastSync (unix seconds) to Apple nanosecond timestamp
      const cutoffAppleTime =
        lastSync > 0
          ? (lastSync - APPLE_EPOCH_OFFSET) * 1_000_000_000
          : 0;

      // Build group chat participant names for chats without display_name
      const groupParticipantNames = new Map<string, string>();
      try {
        const chatRows = db
          .query(
            `SELECT c.chat_identifier, h.id as handle_id
           FROM chat c
           JOIN chat_handle_join chj ON c.ROWID = chj.chat_id
           JOIN handle h ON chj.handle_id = h.ROWID
           WHERE (c.display_name IS NULL OR c.display_name = '')
             AND c.chat_identifier LIKE 'chat%'`
          )
          .all() as any[];

        const chatHandles = new Map<string, string[]>();
        for (const cr of chatRows) {
          const handles = chatHandles.get(cr.chat_identifier) ?? [];
          handles.push(cr.handle_id);
          chatHandles.set(cr.chat_identifier, handles);
        }

        for (const [chatId, handles] of chatHandles) {
          const names = handles.map((h) => resolveContact(h) || h);
          const display = names.slice(0, 5).join(", ");
          groupParticipantNames.set(
            chatId,
            names.length > 5 ? `${display} +${names.length - 5}` : display
          );
        }
      } catch {
        // ignore — contact resolution is best-effort
      }

      const rows = db
        .query(
          `
          SELECT
            m.ROWID as id,
            m.text,
            m.date as msg_date,
            m.is_from_me,
            m.service,
            m.attributedBody,
            h.id as handle_id,
            COALESCE(c.display_name, '') as group_name,
            c.chat_identifier
          FROM message m
          LEFT JOIN handle h ON m.handle_id = h.ROWID
          LEFT JOIN chat_message_join cmj ON m.ROWID = cmj.message_id
          LEFT JOIN chat c ON cmj.chat_id = c.ROWID
          WHERE m.date > ?
          ORDER BY m.date DESC
          LIMIT 5000
          `
        )
        .all(cutoffAppleTime) as Array<{
        id: number;
        text: string | null;
        msg_date: number;
        is_from_me: number;
        service: string;
        attributedBody: Buffer | Uint8Array | null;
        handle_id: string | null;
        group_name: string;
        chat_identifier: string | null;
      }>;

      db.close();

      return rows
        .map((row) => {
          // Extract message text — try plain text first, then attributedBody
          let text = row.text || "";
          if (!text && row.attributedBody) {
            text = extractFromAttributedBody(row.attributedBody) || "";
          }
          if (!text) return null;

          // Determine conversation context
          const isGroup = !!(
            row.group_name ||
            (row.chat_identifier && row.chat_identifier.startsWith("chat"))
          );

          let displayName: string;
          if (row.group_name) {
            displayName = row.group_name;
          } else if (
            row.chat_identifier &&
            row.chat_identifier.startsWith("chat")
          ) {
            displayName =
              groupParticipantNames.get(row.chat_identifier) ||
              row.chat_identifier;
          } else {
            const contactName = row.handle_id
              ? resolveContact(row.handle_id)
              : null;
            displayName = contactName || row.handle_id || "Unknown";
          }

          const createdAt = appleTimeToUnix(row.msg_date);

          return {
            source: "imessage",
            externalId: `imessage-${row.id}`,
            content: text,
            metadata: {
              isFromMe: row.is_from_me === 1,
              service: row.service,
              contactName: displayName,
              isGroup,
              conversationId: row.chat_identifier || row.handle_id || "unknown",
              handle: row.handle_id,
            },
            createdAt,
          };
        })
        .filter((item): item is Item => item !== null);
    } catch (e) {
      console.warn(`[imessage] Failed to read messages: ${e}`);
      return [];
    }
  },
};
