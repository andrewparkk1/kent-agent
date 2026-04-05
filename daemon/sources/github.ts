/**
 * GitHub source — pulls notifications, PRs, and issues via the `gh` CLI.
 * Requires `gh auth login` to be set up. Fetches recent activity and formats
 * it as searchable items with repo, title, author, and URL metadata.
 */
import { arch } from "os";
import type { Source, SyncState, SyncOptions, Item } from "./types";

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
    // --paginate can produce concatenated JSON arrays like [...]\n[...]
    // Try to parse each line and merge arrays
    try {
      const results: any[] = [];
      for (const line of raw.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        const parsed = JSON.parse(trimmed);
        if (Array.isArray(parsed)) results.push(...parsed);
        else results.push(parsed);
      }
      return results.length > 0 ? results : null;
    } catch {
      return null;
    }
  }
}

/** Detect the authenticated GitHub username, or null if gh is unavailable/not logged in. */
async function detectAccount(): Promise<string | null> {
  const raw = await runGh(["api", "user", "--jq", ".login"]);
  return raw && raw.length > 0 ? raw : null;
}

export const github: Source = {
  name: "github",

  async fetchNew(state: SyncState, options?: SyncOptions): Promise<Item[]> {
    const account = await detectAccount();
    if (!account) {
      throw new Error("gh CLI not installed or not authenticated. Run: gh auth login");
    }

    const items: Item[] = [];
    const lastSync = state.getLastSync("github");
    const defaultDays = options?.defaultDays ?? 365;
    const sinceDate = lastSync > 0
      ? new Date(lastSync * 1000).toISOString()
      : defaultDays === 0
        ? new Date(0).toISOString()
        : new Date(Date.now() - defaultDays * 24 * 60 * 60 * 1000).toISOString();

    // -- Phase 1: Notifications + repo list in parallel ------------------
    const [notifications, ownedRaw, contribRaw] = await Promise.all([
      runGhJson(["api", "notifications", "--paginate"]),
      runGh(["api", "user/repos?sort=pushed&per_page=100&type=owner", "--paginate", "--jq", ".[].full_name"]),
      runGh(["api", `users/${account}/repos?sort=pushed&per_page=100&type=member`, "--paginate", "--jq", ".[].full_name"]),
    ]);

    if (Array.isArray(notifications)) {
      for (const n of notifications) {
        items.push({
          source: "github",
          externalId: `github-notif-${n.id}`,
          content: `[${n.reason}] ${n.subject?.title || "Notification"} — ${n.repository?.full_name || ""}`,
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

    const repoSet = new Set<string>();
    for (const raw of [ownedRaw, contribRaw]) {
      if (raw) raw.split("\n").filter(Boolean).forEach((r) => repoSet.add(r));
    }
    const repoNames = [...repoSet];

    // -- Phase 2: Commits in parallel batches of 10 ----------------------
    const BATCH_SIZE = 10;
    for (let i = 0; i < repoNames.length; i += BATCH_SIZE) {
      const batch = repoNames.slice(i, i + BATCH_SIZE);
      const results = await Promise.all(
        batch.map((repo) =>
          runGhJson(["api", `repos/${repo}/commits?since=${sinceDate}&per_page=100&author=${account}`, "--paginate"])
            .then((commits) => ({ repo, commits }))
        )
      );
      for (const { repo, commits } of results) {
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
            metadata: { type: "commit", sha: c.sha, repo, date: commitDate },
            createdAt: Math.floor(when.getTime() / 1000),
          });
        }
      }
    }

    // -- Phase 3: PRs + Issues in parallel --------------------------------
    const [prs, issues] = await Promise.all([
      runGhJson([
        "api", `search/issues?q=author:${account}+type:pr+updated:>=${sinceDate.slice(0, 10)}&per_page=100`, "--paginate",
        "--jq", ".items",
      ]),
      runGhJson([
        "api", `search/issues?q=involves:${account}+type:issue+updated:>=${sinceDate.slice(0, 10)}&per_page=100`, "--paginate",
        "--jq", ".items",
      ]),
    ]);

    if (Array.isArray(prs)) {
      for (const pr of prs) {
        const repo = pr.repository_url?.split("/").slice(-2).join("/") ?? "";
        items.push({
          source: "github",
          externalId: `github-pr-${pr.id}`,
          content: `PR #${pr.number}: ${pr.title} — ${repo} [${pr.state}]`,
          metadata: {
            type: "pr",
            number: pr.number,
            repo,
            state: pr.state,
            url: pr.html_url,
            labels: pr.labels?.map((l: any) => l.name) ?? [],
            draft: pr.draft ?? false,
          },
          createdAt: Math.floor(new Date(pr.updated_at || pr.created_at).getTime() / 1000),
        });
      }
    }

    if (Array.isArray(issues)) {
      for (const issue of issues) {
        const repo = issue.repository_url?.split("/").slice(-2).join("/") ?? "";
        items.push({
          source: "github",
          externalId: `github-issue-${issue.id}`,
          content: `Issue #${issue.number}: ${issue.title} — ${repo} [${issue.state}]`,
          metadata: {
            type: "issue",
            number: issue.number,
            repo,
            state: issue.state,
            url: issue.html_url,
            labels: issue.labels?.map((l: any) => l.name) ?? [],
          },
          createdAt: Math.floor(new Date(issue.updated_at || issue.created_at).getTime() / 1000),
        });
      }
    }

    // Filter out items we've already synced
    if (lastSync > 0) {
      return items.filter((item) => item.createdAt > lastSync);
    }
    return items;
  },
};
