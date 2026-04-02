# GitHub — gh CLI Reference

Use `run_command` to execute these. Requires `gh auth login`.

If a command fails with an auth/token error, run `gh auth login` via `run_command` and retry.

## Issues

```bash
# List issues assigned to you
gh issue list --assignee @me

# List issues in a repo
gh issue list --repo owner/repo

# Create an issue
gh issue create --repo owner/repo --title "Title" --body "Body"

# View issue details
gh issue view 123 --repo owner/repo

# Close an issue
gh issue close 123 --repo owner/repo

# Search issues
gh search issues "query" --repo owner/repo
```

## Pull Requests

```bash
# List open PRs
gh pr list --repo owner/repo

# List PRs you need to review
gh pr list --repo owner/repo --search "review-requested:@me"

# View PR details
gh pr view 456 --repo owner/repo

# View PR diff
gh pr diff 456 --repo owner/repo

# Create a PR
gh pr create --repo owner/repo --title "Title" --body "Body" --base main

# Merge a PR
gh pr merge 456 --repo owner/repo --squash
```

## Notifications

```bash
# List unread notifications
gh api /notifications --jq '.[].subject | {title, type, url}'

# Mark all as read
gh api -X PUT /notifications
```

## Search

```bash
# Search code
gh search code "pattern" --repo owner/repo

# Search repos
gh search repos "query"

# Search commits
gh search commits "query" --repo owner/repo
```

## Repo Info

```bash
# View repo details
gh repo view owner/repo

# List repos you own
gh repo list --source

# Clone a repo
gh repo clone owner/repo
```

## Tips

- Always use `--json` flag for machine-readable output: `gh issue list --json number,title,state`
- Use `--jq` to filter JSON output: `gh issue list --json title --jq '.[].title'`
- Most commands default to the current repo if `--repo` is omitted.
