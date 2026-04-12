import { test, expect, describe } from "bun:test";
import { MockSyncState, validateItem, LIVE } from "./_helpers.ts";
import { createGithubSource, github } from "@daemon/sources/github.ts";

// ─── Fixtures ──────────────────────────────────────────────────────────────

const NOW_MS = 1_700_000_000_000; // fixed clock
const FIXTURES = {
  user: "alice",
  notifications: [
    {
      id: "notif-1",
      reason: "mention",
      unread: true,
      updated_at: "2023-11-14T08:00:00Z",
      subject: { title: "Review my PR", type: "PullRequest", url: "https://api.github.com/repos/alice/foo/pulls/5" },
      repository: { full_name: "alice/foo" },
    },
    {
      id: "notif-2",
      reason: "assign",
      unread: false,
      updated_at: "2023-11-13T11:30:00Z",
      subject: { title: "Bug: crash", type: "Issue", url: "https://api.github.com/repos/alice/bar/issues/2" },
      repository: { full_name: "alice/bar" },
    },
    {
      id: "notif-3",
      reason: "subscribed",
      unread: true,
      updated_at: "2023-11-12T09:00:00Z",
      subject: { title: "New release", type: "Release", url: "https://api.github.com/repos/alice/baz/releases/3" },
      repository: { full_name: "alice/baz" },
    },
  ],
  ownedRepos: "alice/foo\nalice/bar\n",
  contribRepos: "acme/shared\n",
  commits: {
    "alice/foo": [
      {
        sha: "abc1234def5678",
        commit: {
          committer: { date: "2023-11-10T12:00:00Z" },
          author: { date: "2023-11-10T11:55:00Z" },
          message: "Add feature X\n\nLong body ignored",
        },
      },
    ],
    "alice/bar": [
      {
        sha: "fedcba9876543210",
        commit: {
          committer: { date: "2023-11-09T15:00:00Z" },
          author: { date: "2023-11-09T15:00:00Z" },
          message: "Fix bug Y",
        },
      },
    ],
    "acme/shared": [],
  } as Record<string, any[]>,
  prs: [
    {
      id: 9001,
      number: 5,
      title: "Review my PR",
      state: "open",
      html_url: "https://github.com/alice/foo/pull/5",
      repository_url: "https://api.github.com/repos/alice/foo",
      labels: [{ name: "feature" }, { name: "needs-review" }],
      draft: false,
      updated_at: "2023-11-14T08:00:00Z",
      created_at: "2023-11-10T08:00:00Z",
    },
  ],
  issues: [
    {
      id: 9002,
      number: 2,
      title: "Bug: crash",
      state: "closed",
      html_url: "https://github.com/alice/bar/issues/2",
      repository_url: "https://api.github.com/repos/alice/bar",
      labels: [{ name: "bug" }],
      updated_at: "2023-11-13T11:30:00Z",
      created_at: "2023-11-12T11:30:00Z",
    },
  ],
};

/** Build a mock gh runner that returns canned responses per API path. */
function makeRunner(account: string | null = FIXTURES.user) {
  return async (args: string[]): Promise<string | null> => {
    // expected shape: ["api", <path>, ...]
    if (args[0] !== "api") return null;
    const path = args[1] ?? "";

    if (path === "user" && args.includes("--jq")) {
      return account;
    }
    if (path === "notifications") {
      return JSON.stringify(FIXTURES.notifications);
    }
    if (path.startsWith("user/repos")) {
      // owned repos, --jq .[].full_name
      return FIXTURES.ownedRepos.trim();
    }
    if (path.startsWith(`users/${FIXTURES.user}/repos`)) {
      return FIXTURES.contribRepos.trim();
    }
    const commitMatch = path.match(/^repos\/([^/]+\/[^/]+)\/commits/);
    if (commitMatch) {
      return JSON.stringify(FIXTURES.commits[commitMatch[1]!] ?? []);
    }
    if (path.startsWith("search/issues")) {
      if (path.includes("type:pr")) return JSON.stringify(FIXTURES.prs);
      if (path.includes("type:issue")) return JSON.stringify(FIXTURES.issues);
    }
    return null;
  };
}

describe("github source (mocked)", () => {
  test("exported github still conforms to Source interface", () => {
    expect(github.name).toBe("github");
    expect(typeof github.fetchNew).toBe("function");
  });

  test("returns empty array when gh is unauthenticated", async () => {
    const src = createGithubSource({ runner: async () => null, now: () => NOW_MS });
    const items = await src.fetchNew(new MockSyncState());
    expect(items).toEqual([]);
  });

  test("parses notifications, commits, PRs, and issues from mocked responses", async () => {
    const src = createGithubSource({ runner: makeRunner(), now: () => NOW_MS });
    const items = await src.fetchNew(new MockSyncState(), { defaultDays: 365 });

    for (const item of items) validateItem(item, "github", /^github-/);

    // --- notifications
    const notifs = items.filter((i) => i.metadata.type === "notification");
    expect(notifs.length).toBe(3);
    const notif1 = notifs.find((i) => i.externalId === "github-notif-notif-1");
    expect(notif1).toBeDefined();
    expect(notif1!.content).toBe("[mention] Review my PR — alice/foo");
    expect(notif1!.metadata.reason).toBe("mention");
    expect(notif1!.metadata.repo).toBe("alice/foo");
    expect(notif1!.metadata.subjectType).toBe("PullRequest");
    expect(notif1!.metadata.unread).toBe(true);
    expect(notif1!.createdAt).toBe(Math.floor(Date.parse("2023-11-14T08:00:00Z") / 1000));

    // --- commits
    const commits = items.filter((i) => i.metadata.type === "commit");
    expect(commits.length).toBe(2);
    const fooCommit = commits.find((c) => c.metadata.repo === "alice/foo");
    expect(fooCommit).toBeDefined();
    expect(fooCommit!.externalId).toBe("github-commit-abc1234def5678");
    expect(fooCommit!.content).toBe("`abc1234` Add feature X — alice/foo");
    expect(fooCommit!.metadata.sha).toBe("abc1234def5678");
    expect(fooCommit!.createdAt).toBe(Math.floor(Date.parse("2023-11-10T12:00:00Z") / 1000));

    // --- PRs
    const prs = items.filter((i) => i.metadata.type === "pr");
    expect(prs.length).toBe(1);
    const pr = prs[0]!;
    expect(pr.externalId).toBe("github-pr-9001");
    expect(pr.content).toBe("PR #5: Review my PR — alice/foo [open]");
    expect(pr.metadata.number).toBe(5);
    expect(pr.metadata.repo).toBe("alice/foo");
    expect(pr.metadata.state).toBe("open");
    expect(pr.metadata.labels).toEqual(["feature", "needs-review"]);
    expect(pr.metadata.draft).toBe(false);

    // --- issues
    const issues = items.filter((i) => i.metadata.type === "issue");
    expect(issues.length).toBe(1);
    const issue = issues[0]!;
    expect(issue.externalId).toBe("github-issue-9002");
    expect(issue.content).toBe("Issue #2: Bug: crash — alice/bar [closed]");
    expect(issue.metadata.labels).toEqual(["bug"]);
  });

  test("filters items older than lastSync", async () => {
    const src = createGithubSource({ runner: makeRunner(), now: () => NOW_MS });
    const state = new MockSyncState();
    // lastSync just after notif-2 (2023-11-13T11:30:00Z)
    const cutoff = Math.floor(Date.parse("2023-11-13T12:00:00Z") / 1000);
    state.resetSync("github", cutoff);

    const items = await src.fetchNew(state, { defaultDays: 365 });
    // Only notif-1 (Nov 14) and the foo commit? foo commit is Nov 10 - filtered
    // PR is Nov 14 - included. Issue is Nov 13 11:30 - equal, filtered (uses >).
    const ids = items.map((i) => i.externalId).sort();
    expect(ids).toContain("github-notif-notif-1");
    expect(ids).toContain("github-pr-9001");
    expect(ids).not.toContain("github-notif-notif-2");
    expect(ids).not.toContain("github-notif-notif-3");
    expect(ids).not.toContain("github-issue-9002");
    for (const item of items) {
      expect(item.createdAt).toBeGreaterThan(cutoff);
    }
  });

  test.skipIf(!LIVE)("LIVE: pulls real GitHub notifications", async () => {
    const items = await github.fetchNew(new MockSyncState(), { defaultDays: 7, limit: 10 });
    for (const item of items) validateItem(item, "github", /^github-/);
  }, 120_000);
});
