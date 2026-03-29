import type { Source, SyncState, Item } from "./types";

async function runGh(args: string[]): Promise<string | null> {
  try {
    const proc = Bun.spawn(["gh", ...args], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const stdout = await new Response(proc.stdout).text();
    const exitCode = await proc.exited;
    if (exitCode !== 0) return null;
    return stdout.trim();
  } catch {
    return null;
  }
}

export const github: Source = {
  name: "github",

  async fetchNew(state: SyncState): Promise<Item[]> {
    try {
      // Check if gh CLI is available
      const whichProc = Bun.spawn(["which", "gh"], {
        stdout: "pipe",
        stderr: "pipe",
      });
      if ((await whichProc.exited) !== 0) {
        console.warn("[github] gh CLI not installed, skipping");
        return [];
      }

      const items: Item[] = [];

      // Fetch notifications
      const notificationsRaw = await runGh([
        "api",
        "/notifications",
        "--paginate",
      ]);
      if (notificationsRaw) {
        try {
          const notifications = JSON.parse(notificationsRaw);
          if (Array.isArray(notifications)) {
            for (const n of notifications) {
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
        } catch (e) {
          console.warn(`[github] Failed to parse notifications: ${e}`);
        }
      }

      // Fetch assigned issues
      const issuesRaw = await runGh([
        "issue",
        "list",
        "--assignee",
        "@me",
        "--json",
        "number,title,body,url,createdAt,repository,labels,state",
        "--limit",
        "50",
      ]);
      if (issuesRaw) {
        try {
          const issues = JSON.parse(issuesRaw);
          if (Array.isArray(issues)) {
            for (const issue of issues) {
              items.push({
                source: "github",
                externalId: `github-issue-${issue.url || issue.number}`,
                content: `Issue #${issue.number}: ${issue.title}\n${issue.body || ""}`.trim(),
                metadata: {
                  type: "issue",
                  number: issue.number,
                  url: issue.url,
                  state: issue.state,
                  labels: issue.labels?.map((l: any) => l.name) || [],
                  repository: issue.repository?.nameWithOwner,
                },
                createdAt: issue.createdAt
                  ? Math.floor(new Date(issue.createdAt).getTime() / 1000)
                  : Math.floor(Date.now() / 1000),
              });
            }
          }
        } catch (e) {
          console.warn(`[github] Failed to parse issues: ${e}`);
        }
      }

      // Fetch authored PRs
      const authoredPRsRaw = await runGh([
        "pr",
        "list",
        "--author",
        "@me",
        "--json",
        "number,title,body,url,createdAt,repository,state,reviewDecision",
        "--limit",
        "50",
      ]);
      if (authoredPRsRaw) {
        try {
          const prs = JSON.parse(authoredPRsRaw);
          if (Array.isArray(prs)) {
            for (const pr of prs) {
              items.push({
                source: "github",
                externalId: `github-pr-authored-${pr.url || pr.number}`,
                content: `PR #${pr.number}: ${pr.title}\n${pr.body || ""}`.trim(),
                metadata: {
                  type: "pr-authored",
                  number: pr.number,
                  url: pr.url,
                  state: pr.state,
                  reviewDecision: pr.reviewDecision,
                  repository: pr.repository?.nameWithOwner,
                },
                createdAt: pr.createdAt
                  ? Math.floor(new Date(pr.createdAt).getTime() / 1000)
                  : Math.floor(Date.now() / 1000),
              });
            }
          }
        } catch (e) {
          console.warn(`[github] Failed to parse authored PRs: ${e}`);
        }
      }

      // Fetch review-requested PRs
      const reviewPRsRaw = await runGh([
        "pr",
        "list",
        "--search",
        "review-requested:@me",
        "--json",
        "number,title,body,url,createdAt,repository,state",
        "--limit",
        "50",
      ]);
      if (reviewPRsRaw) {
        try {
          const prs = JSON.parse(reviewPRsRaw);
          if (Array.isArray(prs)) {
            for (const pr of prs) {
              items.push({
                source: "github",
                externalId: `github-pr-review-${pr.url || pr.number}`,
                content: `Review requested: PR #${pr.number}: ${pr.title}\n${pr.body || ""}`.trim(),
                metadata: {
                  type: "pr-review-requested",
                  number: pr.number,
                  url: pr.url,
                  state: pr.state,
                  repository: pr.repository?.nameWithOwner,
                },
                createdAt: pr.createdAt
                  ? Math.floor(new Date(pr.createdAt).getTime() / 1000)
                  : Math.floor(Date.now() / 1000),
              });
            }
          }
        } catch (e) {
          console.warn(`[github] Failed to parse review PRs: ${e}`);
        }
      }

      return items;
    } catch (e) {
      console.warn(`[github] Failed to fetch data: ${e}`);
      return [];
    }
  },
};
