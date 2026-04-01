/**
 * GitHub source — pulls notifications, PRs, and issues via the `gh` CLI.
 * Requires `gh auth login` to be set up. Fetches recent activity and formats
 * it as searchable items with repo, title, author, and URL metadata.
 */
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

      // Fetch recent commits from repos the user has pushed to
      const lastSync = state.getLastSync("github");
      const sinceDate = lastSync > 0
        ? new Date(lastSync * 1000).toISOString()
        : new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();

      // Get repos the user has recently pushed to
      const repoRaw = await runGh([
        "api", "user/repos",
        "--jq", ".[].full_name",
        "-q", "sort=pushed", "-q", "per_page=15", "-q", "type=owner",
      ]);
      const repoNames = repoRaw ? repoRaw.split("\n").filter(Boolean) : [];

      for (const repo of repoNames.slice(0, 10)) {
        const commits = await runGhJson([
          "api", `repos/${repo}/commits?since=${sinceDate}&per_page=30&author=${account}`,
        ]);
        if (!Array.isArray(commits)) continue;

        for (const c of commits) {
          const commitDate = c?.commit?.committer?.date ?? c?.commit?.author?.date ?? "";
          const when = new Date(commitDate);
          if (!commitDate || Number.isNaN(when.getTime())) continue;
          const message = (c?.commit?.message ?? "").split("\n")[0];
          const sha = (c?.sha ?? "").slice(0, 7);
          if (!sha || !message) continue;
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
