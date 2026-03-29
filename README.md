# Kent

Kent is an open-source personal AI agent that runs on your Mac.

- **Syncs your data** — iMessage, Gmail, GitHub, Granola meetings, Chrome history, Apple Notes. All indexed locally and pushed to Convex.
- **Answers questions with your context** — "What should I focus on today?" pulls from real messages, meetings, and notifications.
- **Runs workflows on a schedule** — daily briefs, PR summaries, meeting follow-ups. Delivered to your terminal or Telegram.

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│  Mac (daemon — Bun)                                     │
│  iMessage · Signal · Granola · Gmail · GitHub · Chrome  │
│       ↓ sync every 5min                                 │
├─────────────────────────────────────────────────────────┤
│  Convex Cloud                                           │
│  items · workflows · runs · encrypted keys              │
│       ↓ on run/workflow trigger                         │
├─────────────────────────────────────────────────────────┤
│  Agent (pi-agent-core)                                  │
│  Local subprocess OR E2B sandbox (ephemeral)            │
│  Claude/GPT · tools · your keys injected at runtime     │
└─────────────────────────────────────────────────────────┘
```

## Install

```bash
curl -fsSL https://raw.githubusercontent.com/andrewgao/kent-cli/main/scripts/install.sh | bash
kent init
```

Requires macOS and [Bun](https://bun.sh) (installed automatically if missing).

## Sources

| Source | Status | Notes |
|--------|--------|-------|
| iMessage | ✅ Stable | Reads `~/Library/Messages/chat.db`. Requires Full Disk Access for your terminal. |
| Signal | ⚠️ Requires setup | Needs `brew install sqlcipher` and Signal Desktop installed. |
| Granola | ✅ Stable | Reads JSON files from `~/Library/Application Support/Granola/`. |
| Gmail | ✅ Stable | Uses [gws CLI](https://github.com/nicholasgasior/gws). Run `gws auth login` first. |
| GitHub | ✅ Stable | Uses [gh CLI](https://cli.github.com). Run `gh auth login` first. |
| Chrome | ✅ Stable | Reads history, bookmarks, downloads, top sites from Chrome's SQLite DBs. |
| Apple Notes | ✅ Stable | Reads `NoteStore.sqlite`. Requires Full Disk Access. |

## Built-in Workflows

Kent ships with workflow templates in `~/.kent/workflows/`:

| Workflow | Schedule | What it does |
|----------|----------|-------------|
| `daily-brief` | Every day at 8am | Summarizes messages, emails, meetings, and GitHub activity. Prioritizes action items. |
| `weekly-review` | Friday at 5pm | Week-in-review across all sources. Groups by project, highlights shipped work and pending items. |
| `pr-summary` | On GitHub sync | Lists open PRs with review status and unresolved comments. |
| `meeting-followup` | On Granola sync | Extracts action items from meetings and drafts follow-up messages. |

Run any workflow manually:

```bash
kent workflow run daily-brief
```

## Custom Workflows

Create a YAML file in `~/.kent/workflows/`:

```yaml
name: "standup-prep"
prompt: "Based on my activity in the last 24 hours, draft my standup update. Format: what I did yesterday, what I'm doing today, any blockers."
schedule: "0 9 * * 1-5"
runner: "cloud"
output: "telegram"
```

Fields:

| Field | Required | Description |
|-------|----------|-------------|
| `name` | Yes | Unique identifier |
| `prompt` | Yes | The instruction sent to the agent |
| `schedule` | No | Cron expression. Omit for manual-only. |
| `trigger` | No | Source name. Runs when that source syncs new data. |
| `runner` | No | `cloud` (E2B sandbox) or `local` (subprocess with filesystem access). Default: `cloud`. |
| `output` | No | `stdout`, `telegram`, or `file:/path`. Default: `stdout`. |

## Security — BYOK (Bring Your Own Keys)

Kent never stores your API keys in plaintext on any server.

**How it works:**

1. `kent init` generates a random `device_token` (32 bytes, base64url) and a `salt` (16 bytes), both stored locally in `~/.kent/`.
2. Your API keys (Anthropic, OpenAI, etc.) are encrypted with **AES-256-GCM** using a key derived via **PBKDF2** (600,000 iterations, SHA-256) from your device token + salt.
3. The encrypted blob is stored in Convex. The device token and salt never leave your Mac.
4. At runtime, the agent decrypts keys locally before injecting them into the execution environment.
5. **Local runner**: keys stay on your Mac entirely. The agent runs as a subprocess.
6. **Cloud runner**: keys are injected into an ephemeral [E2B](https://e2b.dev) sandbox that is destroyed after the run.

**What you need:**

| Key | Required | Used for |
|-----|----------|----------|
| Anthropic API key | Yes (or OpenAI) | Agent LLM (Claude) |
| OpenAI API key | Optional | Alternative LLM provider |
| E2B API key | Optional | Cloud runner sandboxes |
| Telegram bot token | Optional | Telegram channel |

All keys are set during `kent init` and can be updated by re-running it.

## Channels

| Channel | Status | Description |
|---------|--------|-------------|
| TUI | ✅ Default | Interactive terminal REPL. `kent` with no arguments. |
| Telegram | ✅ Available | Chat with Kent from your phone. Receives workflow notifications. |
| WhatsApp | Planned | — |
| Slack | Planned | — |
| Discord | Planned | — |

Start a channel:

```bash
kent channel start telegram
```

## Usage

```bash
kent                              # Interactive REPL (cloud runner)
kent --local                      # Interactive REPL (local runner — full filesystem access)
kent init                         # Setup wizard
kent daemon start|stop|status     # Manage background sync daemon
kent sync                         # Manual sync all sources
kent sync --source imessage       # Sync specific source
kent workflow list                # List workflows
kent workflow run <name>          # Run a workflow
kent channel start telegram       # Start Telegram channel
```

## Development

```bash
git clone https://github.com/andrewgao/kent-cli.git
cd kent-cli
bun install
bun run cli/index.ts --help
```

Populate demo data:

```bash
bun run scripts/mock-data.ts
```

Record a demo:

```bash
brew install asciinema
bun run scripts/mock-data.ts
asciinema rec kent-demo.cast -c "bash scripts/demo.sh"
```

## Contributing

1. Fork the repo
2. Create a branch (`git checkout -b feature/my-feature`)
3. Make your changes
4. Run tests (`bun test`)
5. Open a PR

Areas where contributions are welcome:

- New source adapters (Slack, Discord, Notion, Linear, etc.)
- New channel adapters (WhatsApp, Slack, Discord)
- Workflow templates
- Agent skill files
- Bug fixes and documentation

## License

MIT
