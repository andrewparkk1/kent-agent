# Kent

Your personal AI agent that runs on your Mac. Kent syncs your data — iMessage, Gmail, GitHub, Chrome, Granola, Apple Notes — indexes it locally, and runs scheduled workflows powered by Claude.

Ask it what to focus on today. Get a daily brief of your meetings, emails, and PRs. Let it draft follow-ups from meetings. All your data stays on your machine.

## Install

```bash
# requires macOS and Bun (https://bun.sh)
bun install -g kent-agent
kent init
```

`kent init` walks you through connecting sources, adding your API keys, runs your first sync, starts the daemon, and opens the web dashboard.

## Quick start

```bash
kent                          # interactive chat
kent run                      # start daemon + web dashboard
kent web                      # open web dashboard
```

## What it does

**Syncs your data** from local and cloud sources every few minutes. Everything is stored in a local SQLite database at `~/.kent/kent.db`.

**Answers questions with your context.** The agent has tools to search across all your synced data, so it can answer things like "what did Sarah say about the launch?" or "summarize my unread GitHub notifications."

**Runs workflows on a schedule.** Workflows are prompts that run on a cron schedule. Kent ships with defaults (morning briefing, evening recap, memory curator) and you can create your own.

**Remembers things.** The agent maintains a persistent knowledge base — people, projects, preferences, events — that it references across conversations.

## Architecture

```
┌──────────────────────────────────────────┐
│  CLI / TUI / Web Dashboard               │
├──────────────────────────────────────────┤
│  Daemon (background process)             │
│  ├─ Sync loop → sources every N min      │
│  └─ Cron loop → run due workflows        │
├──────────────────────────────────────────┤
│  Agent (subprocess, pi-agent-core)       │
│  ├─ Claude API                           │
│  └─ Tools: data, memory, workflow, fs    │
├──────────────────────────────────────────┤
│  SQLite (~/.kent/kent.db)                │
│  items · threads · workflows · memories  │
└──────────────────────────────────────────┘
```

## Sources

| Source | Status | Notes |
|--------|--------|-------|
| iMessage | Stable | Reads `chat.db`. Requires Full Disk Access. |
| Gmail | Stable | Via `gws` CLI. Also syncs Google Calendar and Tasks. |
| GitHub | Stable | Via `gh` CLI. Notifications, PRs, issues. |
| Chrome | Stable | History, bookmarks, downloads, search terms. |
| Granola | Stable | Meeting transcripts from local JSON files. |
| Apple Notes | Stable | Reads `NoteStore.sqlite`. Requires Full Disk Access. |
| Signal | Stable | Reads encrypted DB. Needs `brew install sqlcipher` and Signal Desktop. |

## Workflows

Kent ships with default workflows:

| Workflow | Schedule | What it does |
|----------|----------|--------------|
| Morning briefing | 8am daily | Calendar, emails, to-dos, action items |
| Evening recap | 6pm daily | Today's summary, highlights, tomorrow preview |
| Memory curator | 10am daily | Reviews data, updates memories, archives stale ones |
| Workflow suggestor | 9:30am daily | Analyzes patterns, suggests new automations |

### Custom workflows

```bash
kent workflow create
```

Or create a YAML file in `~/.kent/workflows/`:

```yaml
name: standup-prep
description: Draft my standup update
prompt: >
  Based on my activity in the last 24 hours, draft my standup update.
  Format: what I did yesterday, what I'm doing today, any blockers.
cron_schedule: "0 9 * * 1-5"
```

### Run manually

```bash
kent workflow run morning-briefing
kent workflow list
kent workflow history
```

## Web dashboard

```bash
kent web
```

Opens a local React dashboard with pages for:

- **Home** — feed of recent workflow runs and briefs
- **Chat** — multi-turn conversations with the agent
- **Workflows** — manage, enable/disable, run, view history
- **Sources** — sync status, item counts, manual sync
- **Memories** — browse and search the knowledge base
- **Identity** — set your name, role, goals for better context
- **Settings** — configure sources, API keys, daemon

## CLI reference

```bash
kent                              # interactive REPL
kent init                         # setup wizard (+ first sync + daemon + web)
kent run                          # start daemon + web dashboard
kent web                          # open web dashboard
kent daemon start|stop|status     # manage background daemon
kent sync                         # sync all sources now
kent sync --source imessage       # sync one source
kent workflow list                # list workflows
kent workflow run <name>          # run a workflow
kent workflow create              # create a workflow
```

## Security

Kent uses BYOK (Bring Your Own Keys). Your API keys are encrypted with AES-256-GCM and never leave your machine in plaintext.

- `kent init` generates a device token and salt, stored locally at `~/.kent/`
- Keys are encrypted at rest using PBKDF2-derived keys (600k iterations)
- The agent decrypts keys on-demand before execution
- All data lives locally in SQLite — nothing is sent to external servers unless you configure it

**Required keys:**

| Key | Required | Used for |
|-----|----------|----------|
| Anthropic API key | Yes | Agent LLM (Claude) |
| OpenAI API key | Optional | Alternative LLM |

## Development

```bash
git clone https://github.com/andrewparkk1/kent-agent.git
cd kent-cli
bun install
bun run cli/index.ts --help
```

Run tests:

```bash
bun test
```

### Project structure

```
cli/          CLI entry point and commands
daemon/       Background sync daemon and source adapters
agent/        Agent subprocess, tools, prompts
shared/       Database, config, shared types
web/          React web dashboard
tests/        Test suite
```

## Contributing

1. Fork the repo
2. Create a branch (`git checkout -b feature/my-feature`)
3. Make your changes
4. Run tests (`bun test`)
5. Open a PR

Contributions welcome: new source adapters, workflow templates, agent tools, bug fixes.

## License

MIT
