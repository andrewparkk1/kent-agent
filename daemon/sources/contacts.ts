/**
 * macOS Contacts source — reads from local AddressBook SQLite databases.
 *
 * AddressBook databases are at:
 *   ~/Library/Application Support/AddressBook/AddressBook-v22.abcddb (main)
 *   ~/Library/Application Support/AddressBook/Sources/<id>/AddressBook-v22.abcddb (per-account)
 *
 * The database may be locked while Contacts.app runs, so we copy to /tmp first.
 * Core Data epoch: seconds since 2001-01-01.
 *   Convert to Unix: unix_seconds = core_data_seconds + 978307200
 */
import { Database } from "bun:sqlite";
import { join } from "path";
import { homedir, tmpdir } from "os";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
} from "fs";
import type { Source, SyncState, SyncOptions, Item } from "./types";

const ADDRESSBOOK_BASE = join(
  homedir(),
  "Library/Application Support/AddressBook"
);
const TEMP_DIR = join(tmpdir(), "kent-contacts");

// Core Data epoch offset: seconds between 1970-01-01 and 2001-01-01
const CORE_DATA_EPOCH_OFFSET = 978307200;

function coreDataTimeToUnix(coreDataTime: number): number {
  return Math.floor(coreDataTime + CORE_DATA_EPOCH_OFFSET);
}

/** Find all AddressBook database paths (main + per-account sources) */
function getAllDbPaths(): string[] {
  const paths: string[] = [];
  const dbName = "AddressBook-v22.abcddb";

  // Main database
  const mainDb = join(ADDRESSBOOK_BASE, dbName);
  if (existsSync(mainDb)) {
    paths.push(mainDb);
  }

  // Per-account source databases
  const sourcesDir = join(ADDRESSBOOK_BASE, "Sources");
  try {
    if (existsSync(sourcesDir)) {
      const entries = readdirSync(sourcesDir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const srcDb = join(sourcesDir, entry.name, dbName);
        if (existsSync(srcDb)) {
          paths.push(srcDb);
        }
      }
    }
  } catch {
    // ignore
  }

  return paths;
}

function copyToTemp(srcPath: string, name: string): string | null {
  if (!existsSync(srcPath)) return null;
  mkdirSync(TEMP_DIR, { recursive: true });
  const dest = join(TEMP_DIR, name);
  try {
    copyFileSync(srcPath, dest);
    return dest;
  } catch (e) {
    console.warn(`[contacts] Failed to copy ${name} to temp: ${e}`);
    return null;
  }
}

interface ContactRow {
  Z_PK: number;
  ZFIRSTNAME: string | null;
  ZLASTNAME: string | null;
  ZNICKNAME: string | null;
  ZORGANIZATION: string | null;
  ZJOBTITLE: string | null;
  ZBIRTHDAY: number | null;
  ZNOTE: string | null;
  ZCREATIONDATE: number;
  ZMODIFICATIONDATE: number;
}

interface PhoneRow {
  ZOWNER: number;
  ZFULLNUMBER: string | null;
  ZLABEL: string | null;
}

interface EmailRow {
  ZOWNER: number;
  ZADDRESS: string | null;
  ZLABEL: string | null;
}

interface AddressRow {
  ZOWNER: number;
  ZSTREET: string | null;
  ZCITY: string | null;
  ZSTATE: string | null;
  ZZIPCODE: string | null;
  ZCOUNTRYNAME: string | null;
  ZLABEL: string | null;
}

/** Clean up Apple-style labels like "_$!<Home>!$_" -> "Home" */
function cleanLabel(label: string | null): string {
  if (!label) return "";
  return label.replace(/_\$!<(.+?)>!\$_/g, "$1").trim();
}

/** Format a contact into a human-readable text block */
function formatContact(
  contact: ContactRow,
  phones: PhoneRow[],
  emails: EmailRow[],
  addresses: AddressRow[]
): string {
  const parts: string[] = [];

  // Name line
  const nameParts = [contact.ZFIRSTNAME, contact.ZLASTNAME]
    .filter(Boolean)
    .join(" ");
  if (nameParts) {
    parts.push(`Name: ${nameParts}`);
  }
  if (contact.ZNICKNAME) {
    parts.push(`Nickname: ${contact.ZNICKNAME}`);
  }

  // Organization / title
  if (contact.ZORGANIZATION) {
    parts.push(`Organization: ${contact.ZORGANIZATION}`);
  }
  if (contact.ZJOBTITLE) {
    parts.push(`Job Title: ${contact.ZJOBTITLE}`);
  }

  // Phone numbers
  for (const phone of phones) {
    if (!phone.ZFULLNUMBER) continue;
    const label = cleanLabel(phone.ZLABEL);
    parts.push(`Phone${label ? ` (${label})` : ""}: ${phone.ZFULLNUMBER}`);
  }

  // Email addresses
  for (const email of emails) {
    if (!email.ZADDRESS) continue;
    const label = cleanLabel(email.ZLABEL);
    parts.push(`Email${label ? ` (${label})` : ""}: ${email.ZADDRESS}`);
  }

  // Postal addresses
  for (const addr of addresses) {
    const addrParts = [
      addr.ZSTREET,
      addr.ZCITY,
      addr.ZSTATE,
      addr.ZZIPCODE,
      addr.ZCOUNTRYNAME,
    ]
      .filter(Boolean)
      .join(", ");
    if (addrParts) {
      const label = cleanLabel(addr.ZLABEL);
      parts.push(`Address${label ? ` (${label})` : ""}: ${addrParts}`);
    }
  }

  // Birthday
  if (contact.ZBIRTHDAY != null) {
    const date = new Date(coreDataTimeToUnix(contact.ZBIRTHDAY) * 1000);
    parts.push(`Birthday: ${date.toISOString().split("T")[0]}`);
  }

  // Notes
  if (contact.ZNOTE) {
    parts.push(`Note: ${contact.ZNOTE}`);
  }

  return parts.join("\n");
}

export const contacts: Source = {
  name: "contacts",

  async fetchNew(state: SyncState, options?: SyncOptions): Promise<Item[]> {
    try {
      const dbPaths = getAllDbPaths();
      if (dbPaths.length === 0) {
        console.warn("[contacts] AddressBook database not found, skipping");
        return [];
      }

      const lastSync = state.getLastSync("contacts");

      // Convert lastSync (unix) to Core Data epoch for comparison
      const lastSyncCoreData =
        lastSync > 0 ? lastSync - CORE_DATA_EPOCH_OFFSET : 0;

      const items: Item[] = [];
      const seenPKs = new Set<number>();
      const limit = options?.limit ?? 5000;

      for (let di = 0; di < dbPaths.length; di++) {
        const dbPath = dbPaths[di]!;
        const tempPath = copyToTemp(dbPath, `AddressBook-${di}.abcddb`);
        if (!tempPath) continue;

        try {
          const db = new Database(tempPath, { readonly: true });

          // Fetch contacts modified after lastSync
          const contactRows = db
            .query(
              `
              SELECT
                Z_PK,
                ZFIRSTNAME,
                ZLASTNAME,
                ZNICKNAME,
                ZORGANIZATION,
                ZJOBTITLE,
                ZBIRTHDAY,
                ZNOTE,
                ZCREATIONDATE,
                ZMODIFICATIONDATE
              FROM ZABCDRECORD
              WHERE ZMODIFICATIONDATE > ?
              ORDER BY ZMODIFICATIONDATE DESC
              LIMIT ?
              `
            )
            .all(lastSyncCoreData, limit) as ContactRow[];

          if (contactRows.length === 0) {
            db.close();
            continue;
          }

          // Collect all contact PKs for batch queries
          const contactPKs = contactRows
            .map((c) => c.Z_PK)
            .filter((pk) => !seenPKs.has(pk));

          if (contactPKs.length === 0) {
            db.close();
            continue;
          }

          const placeholders = contactPKs.map(() => "?").join(",");

          // Fetch phone numbers for these contacts
          const phoneRows = db
            .query(
              `
              SELECT ZOWNER, ZFULLNUMBER, ZLABEL
              FROM ZABCDPHONENUMBER
              WHERE ZOWNER IN (${placeholders})
              `
            )
            .all(...contactPKs) as PhoneRow[];

          // Fetch email addresses
          const emailRows = db
            .query(
              `
              SELECT ZOWNER, ZADDRESS, ZLABEL
              FROM ZABCDEMAILADDRESS
              WHERE ZOWNER IN (${placeholders})
              `
            )
            .all(...contactPKs) as EmailRow[];

          // Fetch postal addresses
          let addressRows: AddressRow[] = [];
          try {
            addressRows = db
              .query(
                `
                SELECT ZOWNER, ZSTREET, ZCITY, ZSTATE, ZZIPCODE, ZCOUNTRYNAME, ZLABEL
                FROM ZABCDPOSTALADDRESS
                WHERE ZOWNER IN (${placeholders})
                `
              )
              .all(...contactPKs) as AddressRow[];
          } catch {
            // Postal address table may not exist in all databases
          }

          db.close();

          // Group related records by owner PK
          const phonesByOwner = new Map<number, PhoneRow[]>();
          for (const phone of phoneRows) {
            const list = phonesByOwner.get(phone.ZOWNER) ?? [];
            list.push(phone);
            phonesByOwner.set(phone.ZOWNER, list);
          }

          const emailsByOwner = new Map<number, EmailRow[]>();
          for (const email of emailRows) {
            const list = emailsByOwner.get(email.ZOWNER) ?? [];
            list.push(email);
            emailsByOwner.set(email.ZOWNER, list);
          }

          const addressesByOwner = new Map<number, AddressRow[]>();
          for (const addr of addressRows) {
            const list = addressesByOwner.get(addr.ZOWNER) ?? [];
            list.push(addr);
            addressesByOwner.set(addr.ZOWNER, list);
          }

          // Build items
          for (const contact of contactRows) {
            if (seenPKs.has(contact.Z_PK)) continue;
            seenPKs.add(contact.Z_PK);

            const phones = phonesByOwner.get(contact.Z_PK) ?? [];
            const emails = emailsByOwner.get(contact.Z_PK) ?? [];
            const addresses = addressesByOwner.get(contact.Z_PK) ?? [];

            const content = formatContact(contact, phones, emails, addresses);

            items.push({
              source: "contacts",
              externalId: `contacts-${contact.Z_PK}`,
              content,
              metadata: {
                firstName: contact.ZFIRSTNAME ?? undefined,
                lastName: contact.ZLASTNAME ?? undefined,
                nickname: contact.ZNICKNAME ?? undefined,
                org: contact.ZORGANIZATION ?? undefined,
                jobTitle: contact.ZJOBTITLE ?? undefined,
                phones: phones
                  .filter((p) => p.ZFULLNUMBER)
                  .map((p) => ({
                    number: p.ZFULLNUMBER,
                    label: cleanLabel(p.ZLABEL),
                  })),
                emails: emails
                  .filter((e) => e.ZADDRESS)
                  .map((e) => ({
                    address: e.ZADDRESS,
                    label: cleanLabel(e.ZLABEL),
                  })),
                birthday:
                  contact.ZBIRTHDAY != null
                    ? new Date(
                        coreDataTimeToUnix(contact.ZBIRTHDAY) * 1000
                      )
                        .toISOString()
                        .split("T")[0]
                    : undefined,
              },
              createdAt: coreDataTimeToUnix(contact.ZCREATIONDATE),
            });
          }

          options?.onProgress?.(items.length);
        } catch (e) {
          console.warn(`[contacts] Failed to read database ${dbPath}: ${e}`);
        }
      }

      return items;
    } catch (e) {
      console.warn(`[contacts] Failed to fetch contacts: ${e}`);
      return [];
    }
  },
};
