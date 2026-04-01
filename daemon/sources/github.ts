import { arch } from "os";
import type { Source, SyncState, Item } from "./types";

// Ensure brew-installed CLIs are discoverable
function buildCliEnv(): Record<string, string> {
  const base = process.env.PATH ?? "/usr/bin:/bin:/usr/sbin:/sbin";
  const brewPrefix = arch() === "arm64" ? "/opt/homebrew/bin" : "/usr/local/bin";
  const PATH = base.includes(brewPrefix) ? base : `${brewPrefix}:${base}`;
  return { ...process.env, PATH } as Record<string, string>;
}

const CLI_ENV = buildCliEnv();

async function runGh(args: string[]): Promise<string | null> {
  try {
    const proc = Bun.spawn(["gh", ...args], {
      stdout: "pipe",
      stderr: "pipe",
      env: CLI_ENV,
    });
    const stdout = await new Response(proc.stdout).text();
    const exitCode = await proc.exited;
    if (exitCode !== 0) return null;
    return stdout.trim();
  } catch {
    return null;
  }
}

async function runGhJson(args: string[]): Promise<any | null> {
  const raw = await runGh(args);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/** Detect the authenticated GitHub username, or null if gh is unavailable/not logged in. */
async function detectAccount(): Promise<string | null> {
  const raw = await runGh(["api", "user", "--jq", ".login"]);
  return raw && raw.length > 0 ? raw : null;
}

export const github: Source = {
  name: "github",

  async fetchNew(state: SyncState): Promise<Item[]> {
    try {
      // Validate gh auth — replaces unreliable `which gh` check
      const account = await detectAccount();
      if (!account) {
        console.warn("[github] gh CLI not installed or not authenticated, skipping");
        return [];
      }

      const items: Item[] = [];

      // Fetch notifications
      const notifications = await runGhJson(["api", "notifications", "--paginate"]);
      if (Array.isArray(notifications)) {
        for (const n of notifications.slice(0, 50)) {
          items.push({
            source: "github",
            externalId: `github-notif-${n.id}`,
            content: `[${n.reason}] ${n.subject?.title || "Notification"}`,
            metadata: {
              type: "notification",
              reason: n.reason,
              repo: n.repository?.full_name,
              subjectType: n.subject?.type,
              subjectUrl: n.subject?.url,
              unread: n.unread,
            },
            createdAt: n.updated_at
              ? Math.floor(new Date(n.updated_at).getTime() / 1000)
              : Math.floor(Date.now() / 1000),
          });
        }
      }

      // Fetch recent commits (primary: gh search commits)
      const lastSync = state.getLastSync("github");
      const daysBack = lastSync > 0
        ? Math.max(1, Math.ceil((Date.now() - lastSync) / 86400000))
        : 3;

      const searched = await runGhJson([
        "search", "commits",
        "--author", account,
        "--limit", "40",
        "--sort", "committer-date",
        "--order", "desc",
        "--json", "sha,repository,commit,url",
      ]);

      const cutoff = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000);
      if (Array.isArray(searched)) {
        for (const c of searched) {
          const commitDate = c?.commit?.committer?.date ?? c?.commit?.author?.date ?? "";
          const when = new Date(commitDate);
          if (!commitDate || Number.isNaN(when.getTime()) || when < cutoff) continue;
          const repo = c?.repository?.fullName ?? c?.repository?.full_name ?? c?.repository?.name ?? "";
          const message = (c?.commit?.message ?? "").split("\n")[0];
          const sha = (c?.sha ?? "").slice(0, 7);
          if (!repo || !sha || !message) continue;
          items.push({
            source: "github",
            externalId: `github-commit-${c.sha}`,
            content: `\`${sha}\` ${message} — ${repo}`,
            metadata: {
              type: "commit",
              sha: c.sha,
              repo,
              date: commitDate,
            },
            createdAt: Math.floor(when.getTime() / 1000),
          });
        }
      }

      // Filter out items we've already synced
      if (lastSync > 0) {
        return items.filter((item) => item.createdAt > lastSync);
      }
      return items;
    } catch (e) {
      console.warn(`[github] Failed to fetch data: ${e}`);
      return [];
    }
  },
};
