/**
 * Granola ingestion — reads the local Granola cache file for metadata,
 * then fetches transcripts and AI summaries from the Granola API.
 *
 * Local cache: ~/Library/Application Support/Granola/cache-v*.json
 * Auth tokens: ~/Library/Application Support/Granola/supabase.json
 * API: https://api.granola.ai/v1/
 */
import { join } from "path";
import { homedir } from "os";
import {
  readdirSync,
  readFileSync,
  existsSync,
} from "fs";
import type { Source, SyncState, SyncOptions, Item } from "./types";

const GRANOLA_DIR = join(
  homedir(),
  "Library/Application Support/Granola"
);

/** Find highest cache-v*.json version dynamically */
function getGranolaCachePath(): string | null {
  try {
    const entries = readdirSync(GRANOLA_DIR);
    const cacheFiles = entries
      .filter((e) => /^cache-v\d+\.json$/.test(e))
      .sort((a, b) => {
        const va = parseInt(a.match(/\d+/)?.[0] ?? "0", 10);
        const vb = parseInt(b.match(/\d+/)?.[0] ?? "0", 10);
        return vb - va; // highest version first
      });
    if (cacheFiles.length > 0) return join(GRANOLA_DIR, cacheFiles[0]!);
  } catch {
    // readdirSync may fail in sandboxed environments — fall through to probes
  }
  // Fallback: probe known versions directly
  for (let v = 10; v >= 3; v--) {
    const p = join(GRANOLA_DIR, `cache-v${v}.json`);
    if (existsSync(p)) return p;
  }
  return null;
}

/** Read and parse Granola cache. Returns the state object or null. */
function readCache(): any | null {
  const cachePath = getGranolaCachePath();
  if (!cachePath || !existsSync(cachePath)) return null;

  try {
    const raw = readFileSync(cachePath, "utf-8");
    const outer = JSON.parse(raw);
    // v3: cache is a JSON string; v4+: cache is an object
    let inner: any;
    if (typeof outer.cache === "string") {
      inner = JSON.parse(outer.cache);
    } else if (outer.cache && typeof outer.cache === "object") {
      inner = outer.cache;
    } else {
      inner = outer;
    }
    return inner?.state ?? inner;
  } catch (e) {
    console.warn(`[granola] Failed to read cache: ${e}`);
    return null;
  }
}

// ─── Granola API ───────────────────────────────────────────────────────────

const SUPABASE_PATH = join(GRANOLA_DIR, "supabase.json");
const GRANOLA_API = "https://api.granola.ai/v1";

/** Read access token from Granola's local auth storage. */
function getAccessToken(): string | null {
  try {
    if (!existsSync(SUPABASE_PATH)) return null;
    const data = JSON.parse(readFileSync(SUPABASE_PATH, "utf-8"));
    const tokens = JSON.parse(data.workos_tokens);
    // Check expiry
    const payload = JSON.parse(Buffer.from(tokens.access_token.split(".")[1], "base64url").toString());
    if (Date.now() > payload.exp * 1000) {
      console.warn("[granola] Access token expired, will try refresh");
      return refreshToken(tokens.refresh_token);
    }
    return tokens.access_token;
  } catch (e) {
    console.warn(`[granola] Failed to read access token: ${e}`);
    return null;
  }
}

/** Refresh the access token using the refresh token. */
function refreshToken(refreshToken: string): string | null {
  // Synchronous — we can't await here but this runs in an async context
  // Just return null and let the caller handle it; token will refresh on next Granola app open
  return null;
}

/** Fetch document transcript from Granola API. */
async function fetchTranscript(docId: string, token: string): Promise<string> {
  try {
    const res = await fetch(`${GRANOLA_API}/get-document-transcript`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ document_id: docId }),
    });
    if (!res.ok) return "";
    const segments: any[] = await res.json();
    if (!segments.length) return "";
    return segments
      .filter((s) => s.is_final)
      .map((s) => s.text)
      .join("\n");
  } catch {
    return "";
  }
}

/** Fetch AI-generated panels (summaries) from Granola API. */
async function fetchPanels(docId: string, token: string): Promise<string> {
  try {
    const res = await fetch(`${GRANOLA_API}/get-document-panels`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ document_id: docId }),
    });
    if (!res.ok) return "";
    const panels: any[] = await res.json();
    if (!panels.length) return "";
    return panels
      .map((p) => {
        const title = p.title || "Summary";
        const text = p.content ? extractText(p.content).trim() : "";
        return text ? `### ${title}\n${text}` : "";
      })
      .filter(Boolean)
      .join("\n\n");
  } catch {
    return "";
  }
}

/** Extract plain text from ProseMirror doc nodes */
function extractText(node: any): string {
  if (!node) return "";
  if (node.text) return node.text;
  if (!node.content) return "";
  return node.content
    .map((child: any) => {
      if (child.type === "heading") return extractText(child) + "\n";
      if (child.type === "bulletList" || child.type === "orderedList") {
        return (
          (child.content || [])
            .map((li: any) => "- " + extractText(li).trim())
            .join("\n") + "\n"
        );
      }
      if (child.type === "paragraph") return extractText(child) + "\n";
      return extractText(child);
    })
    .join("");
}

/** Determine the local user's ID by finding the most frequent user_id */
function getOwnerUserId(documents: Record<string, any>): string | null {
  const counts: Record<string, number> = {};
  for (const doc of Object.values(documents)) {
    if (doc.user_id) {
      counts[doc.user_id] = (counts[doc.user_id] || 0) + 1;
    }
  }
  let best: string | null = null;
  let bestCount = 0;
  for (const [uid, count] of Object.entries(counts)) {
    if (count > bestCount) {
      best = uid;
      bestCount = count;
    }
  }
  return best;
}

/** Assemble transcript segments into readable text with timestamps */
function assembleTranscript(segments: any[], maxChars: number = 20000): string {
  if (!segments || segments.length === 0) return "";

  const sorted = [...segments]
    .filter((s) => s.is_final)
    .sort((a, b) => a.start_timestamp.localeCompare(b.start_timestamp));

  const lines: string[] = [];
  let totalChars = 0;

  for (const seg of sorted) {
    const time = new Date(seg.start_timestamp).toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
    });
    const source = seg.source === "microphone" ? "You" : "Other";
    const line = `[${time}] ${source}: ${seg.text}`;
    totalChars += line.length;
    if (totalChars > maxChars) {
      lines.push(`... (${sorted.length - lines.length} more segments)`);
      break;
    }
    lines.push(line);
  }

  return lines.join("\n");
}

/** Extract attendee info from doc.people and meetingsMetadata */
function getAttendees(
  doc: any,
  meetingsMetadata: Record<string, any>
): Array<{ name: string; email?: string; company?: string; title?: string }> {
  const attendees: Array<{
    name: string;
    email?: string;
    company?: string;
    title?: string;
  }> = [];
  const seen = new Set<string>();

  // From doc.people.attendees
  const docAttendees = doc.people?.attendees || [];
  for (const a of docAttendees) {
    const key = (a.email || a.name || "").toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    attendees.push({
      name: a.name || a.email || "Unknown",
      email: a.email,
      company: a.details?.company?.name,
      title: a.details?.person?.jobTitle,
    });
  }

  // From meetingsMetadata (may have enriched data)
  const meta = meetingsMetadata[doc.id];
  if (meta?.attendees) {
    for (const a of meta.attendees) {
      const key = (a.email || a.name || "").toLowerCase();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      attendees.push({
        name: a.name || a.email || "Unknown",
        email: a.email,
        company: a.details?.company?.name,
        title: a.details?.person?.jobTitle,
      });
    }
  }

  // Add creator if not already included
  const creator = doc.people?.creator || meta?.creator;
  if (creator) {
    const key = (creator.email || creator.name || "").toLowerCase();
    if (key && !seen.has(key)) {
      attendees.push({
        name: creator.name || creator.email || "Unknown",
        email: creator.email,
        company: creator.details?.company?.name,
      });
    }
  }

  return attendees;
}

/** Extract chapter titles from a document */
function getChapters(doc: any): string[] {
  if (!doc.chapters || !Array.isArray(doc.chapters)) return [];
  return doc.chapters
    .map((c: any) => c.title || c.name || (typeof c === "string" ? c : ""))
    .filter(Boolean);
}

export const granola: Source = {
  name: "granola",

  async fetchNew(state: SyncState, options?: SyncOptions): Promise<Item[]> {
    try {
      if (!existsSync(GRANOLA_DIR)) {
        console.warn("[granola] Granola directory not found, skipping");
        return [];
      }

      const cacheState = readCache();
      if (!cacheState) {
        console.warn("[granola] Could not read Granola cache");
        return [];
      }

      const lastSync = state.getLastSync("granola");
      const lastSyncDate = lastSync > 0 ? new Date(lastSync * 1000) : new Date(0);
      const items: Item[] = [];
      const token = getAccessToken();

      // --- Meetings (documents) ---
      if (cacheState.documents && typeof cacheState.documents === "object") {
        const ownerUserId = getOwnerUserId(cacheState.documents);
        const localTranscripts: Record<string, any[]> =
          cacheState.transcripts || {};
        const meetingsMetadata: Record<string, any> =
          cacheState.meetingsMetadata || {};

        const docs = Object.values(cacheState.documents) as any[];
        for (const doc of docs) {
          if (!doc.created_at || doc.deleted_at) continue;
          const createdDate = new Date(doc.created_at);
          if (createdDate <= lastSyncDate) continue;
          if (ownerUserId && doc.user_id !== ownerUserId) continue;
          if (!(doc.notes_markdown || doc.notes_plain || doc.title)) continue;

          // AI summary — try local cache first, then API
          let aiSummary = "";
          if (doc.summary) {
            aiSummary =
              typeof doc.summary === "string"
                ? doc.summary
                : JSON.stringify(doc.summary);
          } else if (doc.overview) {
            aiSummary =
              typeof doc.overview === "string"
                ? doc.overview
                : extractText(doc.overview);
          } else {
            const panels = cacheState.documentPanels?.[doc.id];
            if (panels && typeof panels === "object") {
              for (const panel of Object.values(panels) as any[]) {
                if (panel.content) {
                  aiSummary += extractText(panel.content).trim() + "\n";
                }
              }
            }
          }

          const attendees = getAttendees(doc, meetingsMetadata);
          const chapters = getChapters(doc);

          // Transcript: try local cache first, then API
          let transcript = assembleTranscript(localTranscripts[doc.id] || []);

          // Notes: try local sources
          let notes = doc.notes_markdown || doc.notes_plain || "";
          if (!notes.trim() && doc.notes) {
            notes = extractText(doc.notes).trim();
          }

          // If local content is empty, fetch from Granola API
          if (token && !transcript && !aiSummary.trim()) {
            const [apiTranscript, apiPanels] = await Promise.all([
              fetchTranscript(doc.id, token),
              fetchPanels(doc.id, token),
            ]);
            if (apiTranscript) transcript = apiTranscript;
            if (apiPanels) aiSummary = apiPanels;
          }

          const contentParts: string[] = [];
          contentParts.push(`# ${doc.title || "Untitled meeting"}`);
          if (attendees.length > 0) {
            contentParts.push(
              `Attendees: ${attendees.map((a) => a.name).join(", ")}`
            );
          }
          if (chapters.length > 0) {
            contentParts.push(`Topics: ${chapters.join(" → ")}`);
          }
          if (aiSummary.trim()) {
            contentParts.push(`## Summary\n${aiSummary.trim()}`);
          }
          if (notes) {
            contentParts.push(`## Notes\n${notes}`);
          }
          if (transcript) {
            contentParts.push(
              `## Transcript\n${transcript.slice(0, 5000)}`
            );
          }

          items.push({
            source: "granola",
            externalId: `granola-meeting-${doc.id}`,
            content: contentParts.join("\n\n"),
            metadata: {
              title: doc.title || "Untitled meeting",
              attendees: attendees.map((a) => ({
                name: a.name,
                email: a.email,
                company: a.company,
              })),
              chapters,
              hasSummary: !!aiSummary.trim(),
              hasTranscript: !!transcript,
              hasNotes: !!notes,
            },
            createdAt: Math.floor(createdDate.getTime() / 1000),
          });
        }
      }

      // --- Calendar events ---
      if (Array.isArray(cacheState.events)) {
        const now = new Date();
        const twoWeeksOut = new Date(
          now.getTime() + 14 * 24 * 60 * 60 * 1000
        );

        for (const e of cacheState.events) {
          const start = e.start?.dateTime || e.start?.date || "";
          if (!start) continue;
          const startDate = new Date(start);
          // Only include upcoming events
          if (startDate < now || startDate > twoWeeksOut) continue;
          if (e.status === "cancelled") continue;

          items.push({
            source: "granola",
            externalId: `granola-event-${e.id || start}`,
            content: [
              `Event: ${e.summary || "(no title)"}`,
              `When: ${start}`,
              e.location ? `Where: ${e.location}` : "",
            ]
              .filter(Boolean)
              .join("\n"),
            metadata: {
              type: "calendar-event",
              summary: e.summary,
              start,
              end: e.end?.dateTime || e.end?.date || "",
            },
            createdAt: Math.floor(startDate.getTime() / 1000),
          });
        }
      }

      // --- Contacts (people) ---
      if (Array.isArray(cacheState.people)) {
        for (const p of cacheState.people) {
          if (!p.name) continue;
          const createdAt = p.created_at ? new Date(p.created_at) : null;
          if (createdAt && createdAt <= lastSyncDate) continue;

          items.push({
            source: "granola",
            externalId: `granola-contact-${p.email || p.name}`,
            content: [
              p.name,
              p.email ? `<${p.email}>` : "",
              p.company_name ? `@ ${p.company_name}` : "",
              p.job_title ? `(${p.job_title})` : "",
            ]
              .filter(Boolean)
              .join(" "),
            metadata: {
              type: "contact",
              name: p.name,
              email: p.email,
              company: p.company_name,
              jobTitle: p.job_title,
            },
            createdAt: createdAt
              ? Math.floor(createdAt.getTime() / 1000)
              : Math.floor(Date.now() / 1000),
          });
        }
      }

      return items;
    } catch (e) {
      console.warn(`[granola] Failed to read meetings: ${e}`);
      return [];
    }
  },
};
