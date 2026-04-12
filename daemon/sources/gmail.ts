/**
 * Google Workspace ingestion via the `gws` CLI.
 *
 * Exports four separate sources: gmail, gcal (Google Calendar), gtasks (Google Tasks), gdrive (Google Drive).
 *
 * Shells out to `gws` (https://github.com/googleworkspace/cli).
 * Falls back gracefully if `gws` is not installed or no accounts are authenticated.
 */
import type { Source, SyncState, SyncOptions, Item } from "./types";

// ─── Injectable Google Client interface ────────────────────────────────────
//
// A thin abstraction over the network/CLI layer so sources can be tested with
// canned responses. Returning `null` from any method signals "unavailable"
// (no CLI, no auth token, etc.) and the source will return [] gracefully.

export interface GmailListResponse {
  messages?: Array<{ id: string }>;
  nextPageToken?: string;
}

export interface GmailMessageDetail {
  id: string;
  threadId?: string;
  internalDate?: string | number;
  snippet?: string;
  labelIds?: string[];
  payload?: { headers?: Array<{ name: string; value: string }> };
}

export interface GCalEventsResponse {
  items?: any[];
}

export interface GTaskListsResponse {
  items?: Array<{ id: string; title?: string }>;
}

export interface GTasksResponse {
  items?: any[];
}

export interface GDriveFilesResponse {
  files?: any[];
}

export interface GoogleClient {
  listMessages(params: { q: string; maxResults: number; pageToken?: string }): Promise<GmailListResponse | null>;
  getMessage(id: string): Promise<GmailMessageDetail | null>;
  listEvents(params: Record<string, any>): Promise<GCalEventsResponse | null>;
  listTaskLists(): Promise<GTaskListsResponse | null>;
  listTasks(params: Record<string, any>): Promise<GTasksResponse | null>;
  listFiles(params: Record<string, any>): Promise<GDriveFilesResponse | null>;
  exportFile(fileId: string, mimeType: string): Promise<string | null>;
}

// ─── Real gws-backed client (production default) ──────────────────────────

function buildCliEnv(): Record<string, string> {
  const base = process.env.PATH ?? "/usr/bin:/bin:/usr/sbin:/sbin";
  const prefixes = ["/opt/homebrew/bin", "/usr/local/bin"];
  const missing = prefixes.filter((p) => !base.includes(p));
  const PATH = missing.length > 0 ? `${missing.join(":")}:${base}` : base;
  return { ...process.env, PATH } as Record<string, string>;
}

const CLI_ENV = buildCliEnv();

async function runGws(args: string[]): Promise<any | null> {
  try {
    const proc = Bun.spawn(["gws", ...args], { stdout: "pipe", stderr: "pipe", env: CLI_ENV });
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
    const jsonStart = stdout.search(/[{[]/);
    if (jsonStart < 0) return null;
    return JSON.parse(stdout.slice(jsonStart));
  } catch (e) {
    if (e instanceof Error && e.message.startsWith("Token expired")) throw e;
    throw e;
  }
}

async function checkGwsAvailable(): Promise<boolean> {
  try {
    const proc = Bun.spawn(["which", "gws"], { stdout: "pipe", stderr: "pipe", env: CLI_ENV });
    return (await proc.exited) === 0;
  } catch {
    return false;
  }
}

/** Build the production gws-backed client, or null if unavailable. */
export async function createGwsClient(): Promise<GoogleClient | null> {
  if (!(await checkGwsAvailable())) return null;
  return {
    async listMessages(params) {
      return runGws([
        "gmail", "users", "messages", "list",
        "--params", JSON.stringify({ userId: "me", ...params }),
      ]);
    },
    async getMessage(id) {
      return runGws([
        "gmail", "users", "messages", "get",
        "--params", JSON.stringify({
          userId: "me",
          id,
          format: "metadata",
          metadataHeaders: ["Subject", "From", "To", "Date"],
        }),
      ]);
    },
    async listEvents(params) {
      return runGws(["calendar", "events", "list", "--params", JSON.stringify(params)]);
    },
    async listTaskLists() {
      return runGws(["tasks", "tasklists", "list", "--params", "{}"]);
    },
    async listTasks(params) {
      return runGws(["tasks", "tasks", "list", "--params", JSON.stringify(params)]);
    },
    async listFiles(params) {
      return runGws(["drive", "files", "list", "--params", JSON.stringify(params)]);
    },
    async exportFile(fileId, mimeType) {
      try {
        const exportMime =
          mimeType === "application/vnd.google-apps.spreadsheet" ? "text/csv" : "text/plain";
        const proc = Bun.spawn(
          ["gws", "drive", "files", "export", "--fileId", fileId, "--mimeType", exportMime],
          { stdout: "pipe", stderr: "pipe", env: CLI_ENV },
        );
        const stdout = await new Response(proc.stdout).text();
        await proc.exited;
        if (proc.exitCode !== 0 || !stdout.trim()) return null;
        return stdout.trim().slice(0, 5000) || null;
      } catch {
        return null;
      }
    },
  };
}

// ─── Lazy production client resolver ──────────────────────────────────────

let _defaultClientPromise: Promise<GoogleClient | null> | null = null;
function getDefaultClient(): Promise<GoogleClient | null> {
  if (!_defaultClientPromise) _defaultClientPromise = createGwsClient();
  return _defaultClientPromise;
}

function daysBackFromLastSync(lastSync: number, defaultDays = 365, nowMs = Date.now()): number {
  if (lastSync > 0) return Math.max(1, Math.ceil((nowMs / 1000 - lastSync) / 86400));
  if (defaultDays === 0) return 36500;
  return defaultDays;
}

export interface SourceFactoryConfig {
  client?: GoogleClient | null;
  now?: () => number;
}

// ─── Gmail ──────────────────────────────────────────────────────────────────

export function createGmailSource(config: SourceFactoryConfig = {}): Source {
  const now = config.now ?? (() => Date.now());
  return {
    name: "gmail",
    async fetchNew(state: SyncState, options?: SyncOptions): Promise<Item[]> {
      try {
        const client = config.client !== undefined ? config.client : await getDefaultClient();
        if (!client) return [];

        const lastSync = state.getLastSync("gmail");
        const daysBack = daysBackFromLastSync(lastSync, options?.defaultDays, now());
        const maxMessages = options?.limit ?? 500;

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
              const listData = await client.listMessages({ q, maxResults: batchSize, pageToken });
              if (!listData?.messages || !Array.isArray(listData.messages)) break;
              msgs.push(...listData.messages);
              pageToken = listData.nextPageToken;
              if (!pageToken) break;
            }
            return msgs;
          }),
        );

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

        const details: Array<{ msgId: string; detail: GmailMessageDetail | null }> = [];
        const BATCH = 50;
        for (let i = 0; i < allMessageIds.length; i += BATCH) {
          const batch = allMessageIds.slice(i, i + BATCH);
          const batchResults = await Promise.all(
            batch.map(async (msg) => {
              try {
                const detail = await client.getMessage(msg.id);
                return { msgId: msg.id, detail };
              } catch {
                return { msgId: msg.id, detail: null };
              }
            }),
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
          const snippet = detail.snippet ?? "";
          const labels: string[] = detail.labelIds ?? [];

          const internalMs = Number(detail.internalDate);
          const createdAt = internalMs > 0
            ? Math.floor(internalMs / 1000)
            : Math.floor(now() / 1000);

          items.push({
            source: "gmail",
            externalId: `gmail-${detail.id ?? msgId}`,
            content: [
              subject ? `Subject: ${subject}` : "",
              from ? `From: ${from}` : "",
              to ? `To: ${to}` : "",
              snippet,
            ].filter(Boolean).join("\n"),
            metadata: {
              subject,
              from,
              to,
              date,
              labels,
              threadId: detail.threadId,
              isUnread: labels.includes("UNREAD"),
            },
            createdAt,
          });
        }

        if (lastSync > 0) {
          return items.filter((item) => item.createdAt > lastSync);
        }
        return items;
      } catch {
        return [];
      }
    },
  };
}

// ─── Google Calendar ────────────────────────────────────────────────────────

export function createGcalSource(config: SourceFactoryConfig = {}): Source {
  const now = config.now ?? (() => Date.now());
  return {
    name: "gcal",
    async fetchNew(state: SyncState, options?: SyncOptions): Promise<Item[]> {
      try {
        const client = config.client !== undefined ? config.client : await getDefaultClient();
        if (!client) return [];

        const lastSync = state.getLastSync("gcal");
        const daysBack = daysBackFromLastSync(lastSync, options?.defaultDays, now());

        const nowDate = new Date(now());
        const from = new Date(nowDate.getTime() - daysBack * 24 * 60 * 60 * 1000);
        const to = new Date(nowDate.getTime() + 30 * 24 * 60 * 60 * 1000);

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

        const data = await client.listEvents(params);
        if (!data?.items || !Array.isArray(data.items)) return [];

        return data.items
          .filter((e: any) => e.status !== "cancelled")
          .map((e: any) => {
            const start = e.start?.dateTime ?? e.start?.date ?? "";
            const updated = e.updated ?? e.created ?? "";
            const createdAt = updated
              ? Math.floor(new Date(updated).getTime() / 1000)
              : Math.floor(now() / 1000);

            return {
              source: "gcal",
              externalId: `gcal-${e.id}`,
              content: [
                `Event: ${e.summary ?? "(no title)"}`,
                start ? `When: ${start}` : "",
                e.location ? `Where: ${e.location}` : "",
                e.description ? `Description: ${e.description}` : "",
              ].filter(Boolean).join("\n"),
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
      } catch {
        return [];
      }
    },
  };
}

// ─── Google Tasks ───────────────────────────────────────────────────────────

export function createGtasksSource(config: SourceFactoryConfig = {}): Source {
  const now = config.now ?? (() => Date.now());
  return {
    name: "gtasks",
    async fetchNew(state: SyncState, _options?: SyncOptions): Promise<Item[]> {
      try {
        const client = config.client !== undefined ? config.client : await getDefaultClient();
        if (!client) return [];

        const lastSync = state.getLastSync("gtasks");

        const listsData = await client.listTaskLists();
        if (!listsData?.items || !Array.isArray(listsData.items)) return [];

        const listParams: Record<string, any> = {};
        if (lastSync > 0) {
          listParams.updatedMin = new Date(lastSync * 1000).toISOString();
        }

        const listResults = await Promise.all(
          listsData.items.map(async (list: any) => {
            const tasksData = await client.listTasks({ tasklist: list.id, ...listParams });
            if (!tasksData?.items) return [];
            return (tasksData.items as any[])
              .filter((t: any) => t.status !== "completed")
              .map((t: any) => ({ listName: list.title ?? "Tasks", ...t }));
          }),
        );

        const items: Item[] = [];
        for (const task of listResults.flat()) {
          const updated = task.updated ?? "";
          const createdAt = updated
            ? Math.floor(new Date(updated).getTime() / 1000)
            : Math.floor(now() / 1000);

          items.push({
            source: "gtasks",
            externalId: `gtask-${task.id}`,
            content: [
              `Task: ${task.title ?? ""}`,
              task.notes ? `Notes: ${task.notes}` : "",
              task.due ? `Due: ${task.due}` : "",
            ].filter(Boolean).join("\n"),
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
      } catch {
        return [];
      }
    },
  };
}

// ─── Google Drive ──────────────────────────────────────────────────────────

export function createGdriveSource(config: SourceFactoryConfig = {}): Source {
  const now = config.now ?? (() => Date.now());
  return {
    name: "gdrive",
    async fetchNew(state: SyncState, options?: SyncOptions): Promise<Item[]> {
      try {
        const client = config.client !== undefined ? config.client : await getDefaultClient();
        if (!client) return [];

        const lastSync = state.getLastSync("gdrive");
        const daysBack = daysBackFromLastSync(lastSync, options?.defaultDays, now());
        const cutoff = new Date(now() - daysBack * 24 * 60 * 60 * 1000).toISOString();

        const data = await client.listFiles({
          q: `modifiedTime > '${cutoff}' and trashed = false and (mimeType = 'application/vnd.google-apps.document' or mimeType = 'application/vnd.google-apps.spreadsheet' or mimeType = 'application/vnd.google-apps.presentation' or mimeType = 'application/pdf')`,
          fields: "files(id,name,mimeType,modifiedTime,owners,webViewLink,description)",
          pageSize: 50,
          orderBy: "modifiedTime desc",
        });

        if (!data?.files || !Array.isArray(data.files)) return [];

        const mimeLabels: Record<string, string> = {
          "application/vnd.google-apps.document": "Doc",
          "application/vnd.google-apps.spreadsheet": "Sheet",
          "application/vnd.google-apps.presentation": "Slides",
          "application/pdf": "PDF",
        };

        const exportableTypes = new Set([
          "application/vnd.google-apps.document",
          "application/vnd.google-apps.spreadsheet",
          "application/vnd.google-apps.presentation",
        ]);

        const items: Item[] = [];
        for (const f of data.files) {
          const type = mimeLabels[f.mimeType] ?? "File";
          const modified = f.modifiedTime ?? new Date(now()).toISOString();
          const owner = f.owners?.[0]?.displayName ?? "";

          let bodyText: string | null = null;
          if (exportableTypes.has(f.mimeType)) {
            bodyText = await client.exportFile(f.id, f.mimeType);
          }

          const contentParts = [
            `${type}: ${f.name ?? "(untitled)"}`,
            owner ? `Owner: ${owner}` : "",
            `Modified: ${modified}`,
            f.description ? `Description: ${f.description}` : "",
            f.webViewLink ? `Link: ${f.webViewLink}` : "",
          ];
          if (bodyText) contentParts.push("", bodyText);

          items.push({
            source: "gdrive",
            externalId: `gdrive-${f.id}`,
            content: contentParts.filter(Boolean).join("\n"),
            metadata: {
              name: f.name ?? "(untitled)",
              mimeType: f.mimeType,
              type,
              modifiedTime: modified,
              owner,
              webViewLink: f.webViewLink,
              hasContent: !!bodyText,
            },
            createdAt: Math.floor(new Date(modified).getTime() / 1000),
          });
        }

        if (lastSync > 0) {
          return items.filter((item: Item) => item.createdAt > lastSync);
        }
        return items;
      } catch {
        return [];
      }
    },
  };
}

// ─── Production default exports (unchanged API) ────────────────────────────

export const gmail: Source = createGmailSource();
export const gcal: Source = createGcalSource();
export const gtasks: Source = createGtasksSource();
export const gdrive: Source = createGdriveSource();
