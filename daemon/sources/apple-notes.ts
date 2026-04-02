/**
 * Apple Notes — reads notes via AppleScript (HTML body) with SQLite fallback.
 *
 * Primary: AppleScript → HTML → Markdown (preserves headings, lists, bold, links, etc.)
 * Fallback: SQLite protobuf extraction (plain text only)
 */
import { Database } from "bun:sqlite";
import { join } from "path";
import { homedir, tmpdir } from "os";
import { existsSync, copyFileSync, mkdirSync } from "fs";
import { gunzipSync } from "zlib";
import type { Source, SyncState, SyncOptions, Item } from "./types";

// ---------------------------------------------------------------------------
// HTML → Markdown converter (for Apple Notes HTML)
// ---------------------------------------------------------------------------

/** Decode common HTML entities. */
function decodeEntities(html: string): string {
  return html
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
}

/** Strip all HTML tags from a string. */
function stripTags(html: string): string {
  return html.replace(/<[^>]*>/g, "");
}

/**
 * Convert inline HTML formatting to markdown within a text node.
 * Handles: <b>, <strong>, <i>, <em>, <strike>, <s>, <a href>, <u>, <code>
 */
function convertInline(html: string): string {
  let result = html;

  // Links: <a href="url">text</a>
  result = result.replace(/<a\s+href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, (_, url, text) => {
    const clean = stripTags(text).trim();
    if (!clean) return "";
    return `[${clean}](${url})`;
  });

  // Bold
  result = result.replace(/<(b|strong)>([\s\S]*?)<\/\1>/gi, (_, _tag, text) => {
    const clean = convertInline(text).trim();
    return clean ? `**${clean}**` : "";
  });

  // Italic
  result = result.replace(/<(i|em)>([\s\S]*?)<\/\1>/gi, (_, _tag, text) => {
    const clean = convertInline(text).trim();
    return clean ? `*${clean}*` : "";
  });

  // Strikethrough
  result = result.replace(/<(strike|s|del)>([\s\S]*?)<\/\1>/gi, (_, _tag, text) => {
    const clean = convertInline(text).trim();
    return clean ? `~~${clean}~~` : "";
  });

  // Inline code
  result = result.replace(/<code>([\s\S]*?)<\/code>/gi, (_, text) => {
    const clean = stripTags(text);
    return clean ? `\`${clean}\`` : "";
  });

  // Underline (no markdown equivalent, keep text)
  result = result.replace(/<\/?u>/gi, "");

  // Strip remaining spans/font tags but keep content
  result = result.replace(/<span[^>]*>([\s\S]*?)<\/span>/gi, "$1");
  result = result.replace(/<font[^>]*>([\s\S]*?)<\/font>/gi, "$1");

  return result;
}

/**
 * Convert Apple Notes HTML to clean markdown.
 *
 * Handles: headings, bold/italic/strike, links, bullet/numbered/dash lists,
 * nested lists, blockquotes, code blocks, and paragraph breaks.
 */
function htmlToMarkdown(html: string): string {
  // Normalize line breaks
  const normalized = html.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const tokens = tokenizeHtml(normalized);
  const result = processTokens(tokens);
  return result.trim();
}

interface HtmlToken {
  type: "open" | "close" | "self-close" | "text";
  tag?: string;
  attrs?: string;
  content?: string;
}

function tokenizeHtml(html: string): HtmlToken[] {
  const tokens: HtmlToken[] = [];
  const tagRegex = /<\/?([a-z][a-z0-9]*)((?:\s+[^>]*)?)\s*\/?>/gi;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = tagRegex.exec(html)) !== null) {
    // Text before tag
    if (match.index > lastIndex) {
      const text = html.slice(lastIndex, match.index);
      if (text) tokens.push({ type: "text", content: text });
    }

    const full = match[0];
    const tag = match[1]!.toLowerCase();
    const attrs = match[2] || "";

    if (full.startsWith("</")) {
      tokens.push({ type: "close", tag });
    } else if (full.endsWith("/>") || tag === "br" || tag === "hr" || tag === "img") {
      tokens.push({ type: "self-close", tag, attrs });
    } else {
      tokens.push({ type: "open", tag, attrs });
    }

    lastIndex = match.index + full.length;
  }

  // Trailing text
  if (lastIndex < html.length) {
    tokens.push({ type: "text", content: html.slice(lastIndex) });
  }

  return tokens;
}

function processTokens(tokens: HtmlToken[]): string {
  const lines: string[] = [];
  let i = 0;
  const listStack: Array<"ul" | "ol"> = [];
  const olCounter: number[] = [];

  function collectInnerHtml(endTag: string): string {
    let depth = 1;
    let html = "";
    while (i < tokens.length && depth > 0) {
      const tok = tokens[i]!;
      if (tok.type === "open" && tok.tag === endTag) depth++;
      else if (tok.type === "close" && tok.tag === endTag) {
        depth--;
        if (depth === 0) { i++; break; }
      }

      // Reconstruct HTML
      if (tok.type === "text") html += tok.content;
      else if (tok.type === "open") html += `<${tok.tag}${tok.attrs || ""}>`;
      else if (tok.type === "close") html += `</${tok.tag}>`;
      else if (tok.type === "self-close") html += `<${tok.tag}${tok.attrs || ""} />`;
      i++;
    }
    return html;
  }

  while (i < tokens.length) {
    const tok = tokens[i]!;
    i++;

    if (tok.type === "text") {
      const text = decodeEntities(tok.content || "").trim();
      if (text) lines.push(text);
      continue;
    }

    if (tok.type === "self-close") {
      if (tok.tag === "br") lines.push("");
      if (tok.tag === "hr") lines.push("---");
      continue;
    }

    if (tok.type === "close") {
      // Handle list close tags
      if (tok.tag === "ul" || tok.tag === "ol") {
        listStack.pop();
        if (tok.tag === "ol") olCounter.pop();
      }
      continue;
    }

    // Open tags
    const tag = tok.tag!;

    switch (tag) {
      case "h1":
      case "h2":
      case "h3":
      case "h4":
      case "h5":
      case "h6": {
        const inner = collectInnerHtml(tag);
        const text = decodeEntities(convertInline(stripTags(inner))).trim();
        const level = Number(tag[1]);
        const prefix = "#".repeat(level) + " ";
        if (text) lines.push(prefix + text);
        break;
      }

      case "div":
      case "p": {
        const inner = collectInnerHtml(tag);
        // Check if div just wraps a heading or list
        if (inner.match(/^\s*<h[1-6]/i)) {
          const innerTokens = tokenizeHtml(inner);
          const result = processTokens(innerTokens).trim();
          if (result) lines.push(result);
        } else {
          const stripped = stripTags(inner).trim();
          if (stripped === "" || stripped === "\n") {
            lines.push("");
          } else {
            const text = decodeEntities(convertInline(inner)).trim();
            const clean = stripTags(text).trim();
            if (clean) lines.push(clean);
          }
        }
        break;
      }

      case "ul":
      case "ol": {
        listStack.push(tag as "ul" | "ol");
        if (tag === "ol") olCounter.push(0);
        break;
      }

      case "li": {
        const inner = collectInnerHtml("li");
        const depth = listStack.length;
        const indent = "  ".repeat(Math.max(0, depth - 1));
        const listType = listStack[listStack.length - 1] || "ul";

        let prefix: string;
        if (listType === "ol") {
          const idx = olCounter.length - 1;
          if (idx >= 0) olCounter[idx]!++;
          prefix = `${olCounter[idx] ?? 1}. `;
        } else {
          prefix = "- ";
        }

        // Check for nested lists inside this list item
        const hasNestedList = inner.match(/<[ou]l/i);
        if (hasNestedList) {
          const parts = inner.split(/(<[ou]l[\s\S]*)/i);
          const textPart = parts[0] || "";
          const listPart = parts.slice(1).join("");

          const text = decodeEntities(convertInline(stripTags(textPart))).trim();
          if (text) lines.push(indent + prefix + text);

          const nestedTokens = tokenizeHtml(listPart);
          const nestedResult = processTokens(nestedTokens);
          if (nestedResult.trim()) lines.push(nestedResult);
        } else {
          const text = decodeEntities(convertInline(stripTags(inner))).trim();
          if (text) lines.push(indent + prefix + text);
        }
        break;
      }

      case "blockquote": {
        const inner = collectInnerHtml("blockquote");
        const text = decodeEntities(convertInline(stripTags(inner))).trim();
        if (text) {
          for (const line of text.split("\n")) {
            lines.push("> " + line);
          }
        }
        break;
      }

      case "pre": {
        const inner = collectInnerHtml("pre");
        const text = decodeEntities(stripTags(inner));
        lines.push("```");
        lines.push(text);
        lines.push("```");
        break;
      }
    }
  }

  // Collapse 3+ consecutive empty lines to 2
  const output: string[] = [];
  let emptyCount = 0;
  for (const line of lines) {
    if (line.trim() === "") {
      emptyCount++;
      if (emptyCount <= 2) output.push("");
    } else {
      emptyCount = 0;
      output.push(line);
    }
  }

  return output.join("\n");
}

// ---------------------------------------------------------------------------
// AppleScript-based fetcher (primary)
// ---------------------------------------------------------------------------

/**
 * Build AppleScript to fetch notes modified in the last N days.
 * The script is a static template — only DAYS_BACK (a number) is interpolated.
 */
function buildAppleScript(daysBack: number): string {
  return `
set epoch to (current date) - (${Math.floor(daysBack)} * days)
tell application "Notes"
  set output to ""
  set sep to "<<<SEP>>>"
  set delim to "<<<NOTE>>>"
  repeat with n in notes
    try
      if modification date of n > epoch then
        set noteId to id of n
        set t to name of n
        try
          set f to name of container of n
        on error
          set f to "Notes"
        end try
        set b to body of n
        set md to modification date of n as «class isot» as string
        set cd to creation date of n as «class isot» as string
        set output to output & delim & noteId & sep & t & sep & f & sep & md & sep & cd & sep & b
      end if
    end try
  end repeat
  return output
end tell
`;
}

interface AppleScriptNote {
  id: string;
  title: string;
  folder: string;
  modifiedAt: Date;
  createdAt: Date;
  htmlBody: string;
}

function parseAppleScriptOutput(raw: string): AppleScriptNote[] {
  const notes: AppleScriptNote[] = [];
  const chunks = raw.split("<<<NOTE>>>").filter(Boolean);

  for (const chunk of chunks) {
    const parts = chunk.split("<<<SEP>>>");
    if (parts.length < 6) continue;

    const [id, title, folder, modStr, creStr, ...bodyParts] = parts;
    const htmlBody = bodyParts.join("<<<SEP>>>"); // body might contain separator

    notes.push({
      id: id!.trim(),
      title: title!.trim(),
      folder: folder!.trim(),
      modifiedAt: new Date(modStr!.trim()),
      createdAt: new Date(creStr!.trim()),
      htmlBody: htmlBody || "",
    });
  }

  return notes;
}

async function fetchViaAppleScript(lastSyncEpoch: number): Promise<Item[]> {
  const now = Date.now() / 1000;
  const secondsSinceSync = lastSyncEpoch > 0 ? now - lastSyncEpoch : 365 * 24 * 3600;
  const daysBack = Math.max(1, Math.ceil(secondsSinceSync / 86400) + 1);

  const script = buildAppleScript(Math.min(daysBack, 365));

  // osascript with static script — no user input reaches the shell
  const proc = Bun.spawn(["osascript", "-e", script], {
    stdout: "pipe",
    stderr: "pipe",
  });

  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  await proc.exited;

  if (proc.exitCode !== 0) {
    throw new Error(`AppleScript failed (exit ${proc.exitCode}): ${stderr.slice(0, 200)}`);
  }

  const notes = parseAppleScriptOutput(stdout);

  return notes
    .filter((n) => n.title && n.htmlBody)
    .map((n) => {
      let markdown = htmlToMarkdown(n.htmlBody);

      // The HTML body usually starts with the title as <h1> or bold — deduplicate
      const titleHeading = `# ${n.title}`;
      const titleBold = `**${n.title}**`;
      if (markdown.startsWith(titleHeading)) {
        markdown = markdown.slice(titleHeading.length).replace(/^\n+/, "");
      } else if (markdown.startsWith(titleBold)) {
        markdown = markdown.slice(titleBold.length).replace(/^\n+/, "");
      }

      const content = [
        `# ${n.title}`,
        n.folder !== "Notes" ? `Folder: ${n.folder}` : "",
        "",
        markdown,
      ]
        .filter((line) => line !== undefined)
        .join("\n")
        .replace(/\n{3,}/g, "\n\n");

      const createdAt = !isNaN(n.createdAt.getTime())
        ? Math.floor(n.createdAt.getTime() / 1000)
        : Math.floor(Date.now() / 1000);

      const modifiedAt = !isNaN(n.modifiedAt.getTime())
        ? Math.floor(n.modifiedAt.getTime() / 1000)
        : null;

      return {
        source: "apple-notes",
        externalId: n.id || `apple-notes-${n.title}`,
        content,
        metadata: {
          title: n.title,
          folder: n.folder,
          hasFormatting: true,
          wordCount: markdown.split(/\s+/).filter(Boolean).length,
          modifiedAt,
        },
        createdAt,
      };
    });
}

// ---------------------------------------------------------------------------
// SQLite fallback (plain text extraction from protobuf)
// ---------------------------------------------------------------------------

const NOTES_DB = join(
  homedir(),
  "Library/Group Containers/group.com.apple.notes/NoteStore.sqlite"
);

const CORE_DATA_EPOCH_OFFSET = 978307200;

function coreDataToDate(ts: number | null): Date | null {
  if (!ts) return null;
  return new Date((ts + CORE_DATA_EPOCH_OFFSET) * 1000);
}

function readVarint(buf: Buffer, offset: number): [number, number] | null {
  let result = 0;
  let shift = 0;
  let i = offset;
  while (i < buf.length) {
    const byte = buf[i]!;
    result |= (byte & 0x7f) << shift;
    i++;
    if ((byte & 0x80) === 0) return [result, i];
    shift += 7;
    if (shift > 35) return null;
  }
  return null;
}

/**
 * Extract note text from gzip-compressed protobuf data.
 * Navigates: top.field2 (wrapper) → field3 (note body) → field2 (text string)
 * Falls back to string extraction if structured parsing fails.
 */
function extractNoteText(data: Buffer | Uint8Array): string | null {
  try {
    const buf = Buffer.from(gunzipSync(data));

    // Try structured path first: top.f2.f3.f2 = text
    const text = extractTextField(buf);
    if (text && text.length > 1) return text;

    // Fallback: extract all UTF-8 strings from protobuf
    return extractProtobufStrings(buf).join("\n").trim() || null;
  } catch {
    return null;
  }
}

/** Navigate protobuf path to extract the text field. */
function extractTextField(buf: Buffer): string | null {
  try {
    const topFields = parseProtoFields(buf);
    const wrapper = topFields.find((f) => f.fn === 2 && f.buf);
    if (!wrapper?.buf) return null;

    const wrapperFields = parseProtoFields(wrapper.buf);
    const noteBody = wrapperFields.find((f) => f.fn === 3 && f.buf);
    if (!noteBody?.buf) return null;

    const bodyFields = parseProtoFields(noteBody.buf);
    const textField = bodyFields.find((f) => f.fn === 2 && f.buf);
    if (!textField?.buf) return null;

    return textField.buf.toString("utf-8");
  } catch {
    return null;
  }
}

interface ProtoField {
  fn: number;
  val?: number;
  buf?: Buffer;
}

function parseProtoFields(buf: Buffer): ProtoField[] {
  const fields: ProtoField[] = [];
  let i = 0;
  while (i < buf.length) {
    const tag = readVarint(buf, i);
    if (!tag) break;
    i = tag[1];
    const fn = tag[0] >> 3;
    const wt = tag[0] & 7;

    switch (wt) {
      case 0: {
        const v = readVarint(buf, i);
        if (!v) return fields;
        fields.push({ fn, val: v[0] });
        i = v[1];
        break;
      }
      case 1:
        i += 8;
        break;
      case 2: {
        const l = readVarint(buf, i);
        if (!l) return fields;
        const [len, end] = l;
        i = end;
        if (i + len > buf.length) return fields;
        fields.push({ fn, buf: buf.slice(i, i + len) });
        i += len;
        break;
      }
      case 5:
        i += 4;
        break;
      default:
        return fields;
    }
  }
  return fields;
}

/** Fallback: extract all readable strings from protobuf wire format. */
function extractProtobufStrings(buf: Buffer, depth = 0): string[] {
  if (depth > 10 || buf.length === 0) return [];
  const results: string[] = [];
  let i = 0;
  let iterations = 0;
  const maxIterations = buf.length * 2;

  while (i < buf.length && iterations++ < maxIterations) {
    const prevI = i;
    const tagResult = readVarint(buf, i);
    if (!tagResult) break;
    i = tagResult[1];
    const wireType = tagResult[0] & 0x07;

    switch (wireType) {
      case 0: {
        const skip = readVarint(buf, i);
        if (!skip) return results;
        i = skip[1];
        break;
      }
      case 1:
        i += 8;
        break;
      case 2: {
        const lenResult = readVarint(buf, i);
        if (!lenResult) return results;
        const [len, lenEnd] = lenResult;
        i = lenEnd;
        if (len <= 0 || i + len > buf.length) return results;
        const slice = buf.slice(i, i + len);
        i += len;
        try {
          const text = new TextDecoder("utf-8", { fatal: true }).decode(slice);
          const printable = text.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, "");
          if (printable.length > text.length * 0.8 && text.length >= 2) {
            const trimmed = printable.trim();
            if (trimmed.length >= 2 && !/^[A-Z][a-z]+$/.test(trimmed) && !/^NS[A-Z]/.test(trimmed)) {
              results.push(printable);
            }
          }
        } catch {
          results.push(...extractProtobufStrings(slice, depth + 1));
        }
        break;
      }
      case 5:
        i += 4;
        break;
      default:
        return results;
    }
    if (i <= prevI) return results;
  }
  return results;
}

async function fetchViaSqlite(state: SyncState): Promise<Item[]> {
  if (!existsSync(NOTES_DB)) {
    throw new Error("Permission denied — NoteStore.sqlite not accessible (likely missing Full Disk Access)");
  }

  let dbPath = NOTES_DB;
  try {
    const tempDir = join(tmpdir(), "kent-apple-notes");
    mkdirSync(tempDir, { recursive: true });
    const tmpDb = join(tempDir, "NoteStore.sqlite");
    copyFileSync(NOTES_DB, tmpDb);
    const walPath = NOTES_DB + "-wal";
    const shmPath = NOTES_DB + "-shm";
    if (existsSync(walPath)) copyFileSync(walPath, tmpDb + "-wal");
    if (existsSync(shmPath)) copyFileSync(shmPath, tmpDb + "-shm");
    dbPath = tmpDb;
  } catch {}

  let db: InstanceType<typeof Database>;
  try {
    db = new Database(dbPath, { readonly: true });
    db.exec("PRAGMA busy_timeout = 5000");
  } catch (e) {
    const msg = String(e);
    if (msg.includes("unable to open") || msg.includes("authorization denied") || msg.includes("EPERM")) {
      throw new Error("Permission denied — cannot open NoteStore.sqlite (likely missing Full Disk Access)");
    }
    throw e;
  }

  const lastSync = state.getLastSync("apple-notes");
  const lastSyncCoreData = lastSync > 0 ? lastSync - CORE_DATA_EPOCH_OFFSET : 0;

  const rows = db
    .query(
      `SELECT
        n.Z_PK as id, n.ZTITLE1 as title, n.ZSNIPPET as snippet,
        n.ZMODIFICATIONDATE1 as modified, n.ZCREATIONDATE3 as created,
        f.ZTITLE2 as folder, nd.ZDATA as body_data
      FROM ZICCLOUDSYNCINGOBJECT n
      LEFT JOIN ZICCLOUDSYNCINGOBJECT f ON n.ZFOLDER = f.Z_PK
      LEFT JOIN ZICNOTEDATA nd ON nd.ZNOTE = n.Z_PK
      WHERE n.ZTITLE1 IS NOT NULL
        AND (n.ZMARKEDFORDELETION IS NULL OR n.ZMARKEDFORDELETION = 0)
        AND (n.ZISPASSWORDPROTECTED IS NULL OR n.ZISPASSWORDPROTECTED = 0)
        AND n.ZMODIFICATIONDATE1 > ?
      ORDER BY n.ZMODIFICATIONDATE1 DESC
      LIMIT 5000`
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

      let body: string | null = null;
      if (row.body_data) {
        body = extractNoteText(
          row.body_data instanceof Buffer ? row.body_data : Buffer.from(row.body_data)
        );
      }

      const modifiedDate = coreDataToDate(row.modified);
      const createdDate = coreDataToDate(row.created);
      const textContent = body || snippet;
      const content = [`# ${title}`, folder !== "Notes" ? `Folder: ${folder}` : "", textContent]
        .filter(Boolean)
        .join("\n\n");

      return {
        source: "apple-notes",
        externalId: `apple-notes-${row.id}`,
        content,
        metadata: {
          title,
          folder,
          hasFormatting: false,
          wordCount: (textContent || "").split(/\s+/).filter(Boolean).length,
          modifiedAt: modifiedDate ? Math.floor(modifiedDate.getTime() / 1000) : null,
        },
        createdAt: createdDate
          ? Math.floor(createdDate.getTime() / 1000)
          : Math.floor(Date.now() / 1000),
      };
    });
}

// ---------------------------------------------------------------------------
// Source implementation
// ---------------------------------------------------------------------------

export const appleNotes: Source = {
  name: "apple-notes",

  async fetchNew(state: SyncState, options?: SyncOptions): Promise<Item[]> {
    const lastSync = state.getLastSync("apple-notes");

    // Try AppleScript first (gives us rich HTML with all formatting)
    try {
      const items = await fetchViaAppleScript(lastSync);
      return items;
    } catch (e) {
      const msg = String(e);
      console.warn(`[apple-notes] AppleScript failed, falling back to SQLite: ${msg.slice(0, 100)}`);
    }

    // Fallback: SQLite + protobuf (plain text only)
    return fetchViaSqlite(state);
  },
};
