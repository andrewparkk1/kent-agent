/**
 * Google Workspace ingestion via the `gws` CLI.
 *
 * Exports four separate sources: gmail, gcal (Google Calendar), gtasks (Google Tasks), gdrive (Google Drive).
 *
 * Shells out to `gws` (https://github.com/googleworkspace/cli).
 * Falls back gracefully if `gws` is not installed or no accounts are authenticated.
 */
import type { Source, SyncState, Item } from "./types";

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
        console.warn("[gws] Token expired. Run: gws auth login -s gmail,calendar,tasks,drive");
      }
      return null;
    }

    if (!stdout.trim()) return null;

    // gws may print non-JSON preamble; find the first { or [
    const jsonStart = stdout.search(/[{[]/);
    if (jsonStart < 0) return null;
    return JSON.parse(stdout.slice(jsonStart));
  } catch {
    return null;
  }
}

async function checkGws(): Promise<boolean> {
  const proc = Bun.spawn(["which", "gws"], {
    stdout: "pipe",
    stderr: "pipe",
    env: CLI_ENV,
  });
  return (await proc.exited) === 0;
}

function daysBackFromLastSync(lastSync: number): number {
  return lastSync > 0
    ? Math.max(1, Math.ceil((Date.now() / 1000 - lastSync) / 86400))
    : 3;
}

// ─── Gmail ──────────────────────────────────────────────────────────────────

export const gmail: Source = {
  name: "gmail",

  async fetchNew(state: SyncState): Promise<Item[]> {
    if (!(await checkGws())) return [];

    const lastSync = state.getLastSync("gmail");
    const daysBack = daysBackFromLastSync(lastSync);

    // List message IDs
    const listData = await runGws([
      "gmail", "users", "messages", "list",
      "--params", JSON.stringify({
        userId: "me",
        maxResults: 25,
        q: `newer_than:${daysBack}d`,
      }),
    ]);

    if (!listData?.messages || !Array.isArray(listData.messages)) return [];

    const messageIds = listData.messages.slice(0, 25);

    // Fetch metadata for each message concurrently
    const details = await Promise.all(
      messageIds.map(async (msg: any) => {
        const detail = await runGws([
          "gmail", "users", "messages", "get",
          "--params", JSON.stringify({
            userId: "me",
            id: msg.id,
            format: "metadata",
            metadataHeaders: ["Subject", "From", "To", "Date"],
          }),
        ]);
        return { msgId: msg.id, detail };
      })
    );

    const items: Item[] = [];
    for (const { msgId, detail } of details) {
      if (!detail) continue;

      const headers = detail.payload?.headers ?? [];
      const getHeader = (name: string) =>
        headers.find((h: any) => h.name === name)?.value ?? "";

      const subject = getHeader("Subject") || "(no subject)";
      const from = getHeader("From");
      const to = getHeader("To");
      const date = getHeader("Date") || (detail.internalDate
        ? new Date(Number(detail.internalDate)).toISOString()
        : "");
      const snippet = detail.snippet ?? "";
      const labels: string[] = detail.labelIds ?? [];

      items.push({
        source: "gmail",
        externalId: `gmail-${detail.id ?? msgId}`,
        content: [
          subject ? `Subject: ${subject}` : "",
          from ? `From: ${from}` : "",
          to ? `To: ${to}` : "",
          snippet,
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
        createdAt: date
          ? Math.floor(new Date(date).getTime() / 1000)
          : Math.floor(Date.now() / 1000),
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

  async fetchNew(state: SyncState): Promise<Item[]> {
    if (!(await checkGws())) return [];

    const lastSync = state.getLastSync("gcal");
    const daysBack = daysBackFromLastSync(lastSync);

    const now = new Date();
    const from = new Date(now.getTime() - daysBack * 24 * 60 * 60 * 1000);
    const to = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

    const data = await runGws([
      "calendar", "events", "list",
      "--params", JSON.stringify({
        calendarId: "primary",
        maxResults: 50,
        timeMin: from.toISOString(),
        timeMax: to.toISOString(),
        singleEvents: true,
        orderBy: "startTime",
      }),
    ]);

    if (!data?.items || !Array.isArray(data.items)) return [];

    const items = data.items
      .filter((e: any) => e.status !== "cancelled")
      .map((e: any) => {
        const start = e.start?.dateTime ?? e.start?.date ?? "";
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
          createdAt: start
            ? Math.floor(new Date(start).getTime() / 1000)
            : Math.floor(Date.now() / 1000),
        };
      });

    if (lastSync > 0) {
      return items.filter((item: Item) => item.createdAt > lastSync);
    }
    return items;
  },
};

// ─── Google Tasks ───────────────────────────────────────────────────────────

export const gtasks: Source = {
  name: "gtasks",

  async fetchNew(state: SyncState): Promise<Item[]> {
    if (!(await checkGws())) return [];

    const listsData = await runGws([
      "tasks", "tasklists", "list",
      "--params", "{}",
    ]);

    if (!listsData?.items || !Array.isArray(listsData.items)) return [];

    // Fetch all task lists concurrently
    const listResults = await Promise.all(
      listsData.items.map(async (list: any) => {
        const tasksData = await runGws([
          "tasks", "tasks", "list",
          "--params", JSON.stringify({ tasklist: list.id }),
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
        createdAt: task.due
          ? Math.floor(new Date(task.due).getTime() / 1000)
          : Math.floor(Date.now() / 1000),
      });
    }

    return items;
  },
};

// ─── Google Drive ──────────────────────────────────────────────────────────

export const gdrive: Source = {
  name: "gdrive",

  async fetchNew(state: SyncState): Promise<Item[]> {
    if (!(await checkGws())) return [];

    const lastSync = state.getLastSync("gdrive");
    const daysBack = daysBackFromLastSync(lastSync);

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
