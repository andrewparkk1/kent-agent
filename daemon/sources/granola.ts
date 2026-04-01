/**
 * Granola ingestion — reads the local Granola cache file to extract
 * meeting transcripts, notes, AI summaries, calendar events, and contacts.
 *
 * Granola stores everything in ~/Library/Application Support/Granola/cache-v*.json
 * (currently v6, dynamically detected). No API calls needed — just reads the local file.
 */
import { join } from "path";
import { homedir } from "os";
import {
  readdirSync,
  readFileSync,
  existsSync,
} from "fs";
import type { Source, SyncState, Item } from "./types";

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

  async fetchNew(state: SyncState): Promise<Item[]> {
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

      // --- Meetings (documents) ---
      if (cacheState.documents && typeof cacheState.documents === "object") {
        const ownerUserId = getOwnerUserId(cacheState.documents);
        const transcripts: Record<string, any[]> =
          cacheState.transcripts || {};
        const meetingsMetadata: Record<string, any> =
          cacheState.meetingsMetadata || {};

        const docs = Object.values(cacheState.documents) as any[];
        for (const doc of docs) {
          if (!doc.created_at || doc.deleted_at) continue;
          const createdDate = new Date(doc.created_at);
          if (createdDate <= lastSyncDate) continue;
          // Only include meetings from the owner (most frequent user_id)
          if (ownerUserId && doc.user_id !== ownerUserId) continue;
          if (!(doc.notes_markdown || doc.notes_plain || doc.title)) continue;

          // AI summary — try inline fields first (v4+), then panels (v3)
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
          const transcript = assembleTranscript(transcripts[doc.id] || []);
          const notes = doc.notes_markdown || doc.notes_plain || "";

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
