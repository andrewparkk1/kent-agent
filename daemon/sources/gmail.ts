/**
 * Google Workspace ingestion via the `gws` CLI.
 *
 * Exports four separate sources: gmail, gcal (Google Calendar), gtasks (Google Tasks), gdrive (Google Drive).
 *
 * Shells out to `gws` (https://github.com/googleworkspace/cli).
 * Falls back gracefully if `gws` is not installed or no accounts are authenticated.
 */
import type { Source, SyncState, SyncOptions, Item } from "./types";

// Ensure brew-installed CLIs are discoverable
function buildCliEnv(): Record<string, string> {
  const base = process.env.PATH ?? "/usr/bin:/bin:/usr/sbin:/sbin";
  const prefixes = ["/opt/homebrew/bin", "/usr/local/bin"];
  const missing = prefixes.filter((p) => !base.includes(p));
  const PATH = missing.length > 0 ? `${missing.join(":")}:${base}` : base;
  return { ...process.env, PATH } as Record<string, string>;
}

const CLI_ENV = buildCliEnv();

/** Run a gws CLI command and return parsed JSON, or null on failure. */
async function runGws(args: string[]): Promise<any | null> {
  try {
    const proc = Bun.spawn(["gws", ...args], {
      stdout: "pipe",
      stderr: "pipe",
      env: CLI_ENV,
    });

    const stdout = await new Response(proc.stdout).text();
    const stderr = await new Response(proc.stderr).text();
    const exitCode = await proc.exited;

    if (exitCode !== 0) {
      if (stderr.includes("invalid_grant") || stderr.includes("Token has been expired or revoked")) {
        throw new Error("Token expired. Run: gws auth login -s gmail,calendar,tasks,drive");
      }
      throw new Error(stderr.trim().slice(0, 120) || `gws exited with code ${exitCode}`);
    }

    if (!stdout.trim()) return null;

    // gws may print non-JSON preamble; find the first { or [
    const jsonStart = stdout.search(/[{[]/);
    if (jsonStart < 0) return null;
    return JSON.parse(stdout.slice(jsonStart));
  } catch (e) {
    if (e instanceof Error && e.message.startsWith("Token expired")) throw e;
    throw e;
  }
}

async function checkGws(): Promise<void> {
  const proc = Bun.spawn(["which", "gws"], {
    stdout: "pipe",
    stderr: "pipe",
    env: CLI_ENV,
  });
  if ((await proc.exited) !== 0) {
    throw new Error("gws CLI not found. Install: npm i -g @nicholasgasior/gws");
  }
}

function daysBackFromLastSync(lastSync: number, defaultDays = 365): number {
  if (lastSync > 0) return Math.max(1, Math.ceil((Date.now() / 1000 - lastSync) / 86400));
  if (defaultDays === 0) return 36500; // ~100 years = everything
  return defaultDays;
}

/** Extract plain-text body from a Gmail message payload (MIME structure). */
function extractBody(payload: any): string {
  if (!payload) return "";

  // Simple message with body data directly on payload
  if (payload.mimeType === "text/plain" && payload.body?.data) {
    return decodeBase64Url(payload.body.data);
  }

  // Multipart — recurse into parts, prefer text/plain
  if (payload.parts && Array.isArray(payload.parts)) {
    // First pass: look for text/plain
    for (const part of payload.parts) {
      if (part.mimeType === "text/plain" && part.body?.data) {
        return decodeBase64Url(part.body.data);
      }
    }
    // Second pass: recurse into nested multipart
    for (const part of payload.parts) {
      if (part.mimeType?.startsWith("multipart/") || part.parts) {
        const nested = extractBody(part);
        if (nested) return nested;
      }
    }
  }

  return "";
}

function decodeBase64Url(data: string): string {
  const base64 = data.replace(/-/g, "+").replace(/_/g, "/");
  return atob(base64);
}

// ─── Gmail ──────────────────────────────────────────────────────────────────

export const gmail: Source = {
  name: "gmail",

  async fetchNew(state: SyncState, options?: SyncOptions): Promise<Item[]> {
    await checkGws();

    const lastSync = state.getLastSync("gmail");
    const daysBack = daysBackFromLastSync(lastSync, options?.defaultDays);
    const maxMessages = options?.limit ?? 500;

    // Fetch both inbox and sent mail in parallel
    const queries = [
      `newer_than:${daysBack}d in:inbox`,
      `newer_than:${daysBack}d in:sent`,
    ];

    const perQueryLimit = Math.ceil(maxMessages / queries.length);

    const queryResults = await Promise.all(
      queries.map(async (q) => {
        const msgs: Array<{ id: string }> = [];
        let pageToken: string | undefined;
        while (msgs.length < perQueryLimit) {
          const batchSize = Math.min(100, perQueryLimit - msgs.length);
          const params: Record<string, any> = {
            userId: "me",
            maxResults: batchSize,
            q,
          };
          if (pageToken) params.pageToken = pageToken;

          const listData = await runGws([
            "gmail", "users", "messages", "list",
            "--params", JSON.stringify(params),
          ]);

          if (!listData?.messages || !Array.isArray(listData.messages)) break;
          msgs.push(...listData.messages);

          pageToken = listData.nextPageToken;
          if (!pageToken) break;
        }
        return msgs;
      })
    );

    // Dedupe across inbox + sent
    const seenIds = new Set<string>();
    const allMessageIds: Array<{ id: string }> = [];
    for (const msgs of queryResults) {
      for (const msg of msgs) {
        if (!seenIds.has(msg.id)) {
          seenIds.add(msg.id);
          allMessageIds.push(msg);
        }
      }
    }

    if (allMessageIds.length === 0) return [];

    // Fetch metadata concurrently in batches of 20
    const details: Array<{ msgId: string; detail: any }> = [];
    const BATCH = 20;
    for (let i = 0; i < allMessageIds.length; i += BATCH) {
      const batch = allMessageIds.slice(i, i + BATCH);
      const batchResults = await Promise.all(
        batch.map(async (msg) => {
          try {
            const detail = await runGws([
              "gmail", "users", "messages", "get",
              "--params", JSON.stringify({
                userId: "me",
                id: msg.id,
                format: "full",
              }),
            ]);
            return { msgId: msg.id, detail };
          } catch {
            return { msgId: msg.id, detail: null };
          }
        })
      );
      details.push(...batchResults);
      options?.onProgress?.(details.length);
    }

    const items: Item[] = [];
    for (const { msgId, detail } of details) {
      if (!detail) continue;

      const headers = detail.payload?.headers ?? [];
      const getHeader = (name: string) =>
        headers.find((h: any) => h.name === name)?.value ?? "";

      const subject = getHeader("Subject") || "(no subject)";
      const from = getHeader("From");
      const to = getHeader("To");
      const date = getHeader("Date") || "";
      const body = extractBody(detail.payload);
      const snippet = detail.snippet ?? "";
      const labels: string[] = detail.labelIds ?? [];

      // Use internalDate (Gmail's server-side receive time in ms) as the authoritative
      // timestamp — the Date header can be forged, future-dated, or malformed
      const internalMs = Number(detail.internalDate);
      const createdAt = internalMs > 0
        ? Math.floor(internalMs / 1000)
        : Math.floor(Date.now() / 1000);

      items.push({
        source: "gmail",
        externalId: `gmail-${detail.id ?? msgId}`,
        content: [
          subject ? `Subject: ${subject}` : "",
          from ? `From: ${from}` : "",
          to ? `To: ${to}` : "",
          body || snippet,
        ]
          .filter(Boolean)
          .join("\n"),
        metadata: {
          subject,
          from,
          to,
          date,
          labels,
          threadId: detail.threadId,
          isUnread: labels.includes("UNREAD"),
          hasAttachments: !!(detail.payload?.parts?.some(
            (p: any) => p.filename && p.filename.length > 0
          )),
        },
        createdAt,
      });
    }

    if (lastSync > 0) {
      return items.filter((item) => item.createdAt > lastSync);
    }
    return items;
  },
};

// ─── Google Calendar ────────────────────────────────────────────────────────

export const gcal: Source = {
  name: "gcal",

  async fetchNew(state: SyncState, options?: SyncOptions): Promise<Item[]> {
    await checkGws();

    const lastSync = state.getLastSync("gcal");
    const daysBack = daysBackFromLastSync(lastSync, options?.defaultDays);

    const now = new Date();
    const from = new Date(now.getTime() - daysBack * 24 * 60 * 60 * 1000);
    const to = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

    // Use updatedMin to only get events modified since last sync
    const params: Record<string, any> = {
      calendarId: "primary",
      maxResults: 200,
      timeMin: from.toISOString(),
      timeMax: to.toISOString(),
      singleEvents: true,
      orderBy: "startTime",
    };
    if (lastSync > 0) {
      params.updatedMin = new Date(lastSync * 1000).toISOString();
    }

    const data = await runGws([
      "calendar", "events", "list",
      "--params", JSON.stringify(params),
    ]);

    if (!data?.items || !Array.isArray(data.items)) return [];

    return data.items
      .filter((e: any) => e.status !== "cancelled")
      .map((e: any) => {
        const start = e.start?.dateTime ?? e.start?.date ?? "";
        // Use the event's updated timestamp for createdAt (when it was last modified),
        // NOT the event start time — otherwise future events always appear "new"
        const updated = e.updated ?? e.created ?? "";
        const createdAt = updated
          ? Math.floor(new Date(updated).getTime() / 1000)
          : Math.floor(Date.now() / 1000);

        return {
          source: "gcal",
          externalId: `gcal-${e.id}`,
          content: [
            `Event: ${e.summary ?? "(no title)"}`,
            start ? `When: ${start}` : "",
            e.location ? `Where: ${e.location}` : "",
            e.description ? `Description: ${e.description}` : "",
          ]
            .filter(Boolean)
            .join("\n"),
          metadata: {
            summary: e.summary ?? "(no title)",
            start,
            end: e.end?.dateTime ?? e.end?.date ?? "",
            location: e.location,
            attendees: e.attendees
              ?.filter((a: any) => !a.self)
              .map((a: any) => a.email) ?? [],
          },
          createdAt,
        };
      });
  },
};

// ─── Google Tasks ───────────────────────────────────────────────────────────

export const gtasks: Source = {
  name: "gtasks",

  async fetchNew(state: SyncState, options?: SyncOptions): Promise<Item[]> {
    await checkGws();

    const lastSync = state.getLastSync("gtasks");

    const listsData = await runGws([
      "tasks", "tasklists", "list",
      "--params", "{}",
    ]);

    if (!listsData?.items || !Array.isArray(listsData.items)) return [];

    // Fetch task lists — only get tasks updated since last sync
    const listParams: Record<string, any> = {};
    if (lastSync > 0) {
      listParams.updatedMin = new Date(lastSync * 1000).toISOString();
    }

    const listResults = await Promise.all(
      listsData.items.map(async (list: any) => {
        const tasksData = await runGws([
          "tasks", "tasks", "list",
          "--params", JSON.stringify({ tasklist: list.id, ...listParams }),
        ]);
        if (!tasksData?.items) return [];
        return (tasksData.items as any[])
          .filter((t: any) => t.status !== "completed")
          .map((t: any) => ({
            listName: list.title ?? "Tasks",
            ...t,
          }));
      })
    );

    const items: Item[] = [];
    for (const task of listResults.flat()) {
      // Use task's updated timestamp, not due date
      const updated = task.updated ?? "";
      const createdAt = updated
        ? Math.floor(new Date(updated).getTime() / 1000)
        : Math.floor(Date.now() / 1000);

      items.push({
        source: "gtasks",
        externalId: `gtask-${task.id}`,
        content: [
          `Task: ${task.title ?? ""}`,
          task.notes ? `Notes: ${task.notes}` : "",
          task.due ? `Due: ${task.due}` : "",
        ]
          .filter(Boolean)
          .join("\n"),
        metadata: {
          title: task.title ?? "",
          status: task.status ?? "needsAction",
          due: task.due,
          listName: task.listName,
        },
        createdAt,
      });
    }

    return items;
  },
};

// ─── Google Drive ──────────────────────────────────────────────────────────

export const gdrive: Source = {
  name: "gdrive",

  async fetchNew(state: SyncState, options?: SyncOptions): Promise<Item[]> {
    await checkGws();

    const lastSync = state.getLastSync("gdrive");
    const daysBack = daysBackFromLastSync(lastSync, options?.defaultDays);

    const cutoff = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000).toISOString();

    const data = await runGws([
      "drive", "files", "list",
      "--params", JSON.stringify({
        q: `modifiedTime > '${cutoff}' and trashed = false and (mimeType = 'application/vnd.google-apps.document' or mimeType = 'application/vnd.google-apps.spreadsheet' or mimeType = 'application/vnd.google-apps.presentation' or mimeType = 'application/pdf')`,
        fields: "files(id,name,mimeType,modifiedTime,owners,webViewLink,description)",
        pageSize: 50,
        orderBy: "modifiedTime desc",
      }),
    ]);

    if (!data?.files || !Array.isArray(data.files)) return [];

    const mimeLabels: Record<string, string> = {
      "application/vnd.google-apps.document": "Doc",
      "application/vnd.google-apps.spreadsheet": "Sheet",
      "application/vnd.google-apps.presentation": "Slides",
      "application/pdf": "PDF",
    };

    const items: Item[] = data.files.map((f: any) => {
      const type = mimeLabels[f.mimeType] ?? "File";
      const modified = f.modifiedTime ?? new Date().toISOString();
      const owner = f.owners?.[0]?.displayName ?? "";

      return {
        source: "gdrive",
        externalId: `gdrive-${f.id}`,
        content: [
          `${type}: ${f.name ?? "(untitled)"}`,
          owner ? `Owner: ${owner}` : "",
          `Modified: ${modified}`,
          f.description ? `Description: ${f.description}` : "",
          f.webViewLink ? `Link: ${f.webViewLink}` : "",
        ]
          .filter(Boolean)
          .join("\n"),
        metadata: {
          name: f.name ?? "(untitled)",
          mimeType: f.mimeType,
          type,
          modifiedTime: modified,
          owner,
          webViewLink: f.webViewLink,
        },
        createdAt: Math.floor(new Date(modified).getTime() / 1000),
      };
    });

    if (lastSync > 0) {
      return items.filter((item: Item) => item.createdAt > lastSync);
    }
    return items;
  },
};
