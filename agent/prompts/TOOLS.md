# Available Tools

## Memory Tools (always available)

These query your synced data in Convex — messages, emails, meetings, GitHub activity, notes.

### search_semantic
Semantic search across all sources using embeddings. Best for natural language queries.
- `query` (string, required): What to search for
- `sources` (string[], optional): Filter to specific sources
- `limit` (number, optional): Max results (default 20)

### search_exact
Full-text keyword search. Best for exact names, IDs, or specific phrases.
- `query` (string, required): Keywords to search
- `sources` (string[], optional): Filter to specific sources
- `limit` (number, optional): Max results (default 20)

### get_recent_items
Get the latest items from one or more sources, sorted by time.
- `sources` (string[], optional): Filter to specific sources
- `limit` (number, optional): Max results (default 20)

### browse_items
Filter and paginate items by source, date range, or sender.
- `source` (string, optional): Source name
- `sender` (string, optional): Filter by sender
- `after` (string, optional): ISO date string, items after this date
- `before` (string, optional): ISO date string, items before this date
- `cursor` (string, optional): Pagination cursor
- `limit` (number, optional): Max results (default 20)

### get_item_detail
Get the full content of a specific item by its ID.
- `id` (string, required): Item ID

### get_source_stats
Get item counts and date ranges per source. No parameters. Use this to understand what data is available before searching.

## Prompt Management Tools (always available)

These let you read and modify your own configuration files stored in Convex. Changes persist across runs and sandbox restarts.

### list_prompt_files
List all your prompt/config files. Returns names, sizes, and last updated times. No parameters.

### get_prompt_file
Read the content of one of your prompt files.
- `name` (string, required): File name, e.g. "IDENTITY.md", "SOUL.md", "skills/github.md"

### update_prompt_file
Create or update a prompt file. Use this to modify your identity, personality, tools reference, or skill files. You can also create new skill files (e.g. "skills/jira.md").
- `name` (string, required): File name
- `content` (string, required): New file content

**Important**: Always use `update_prompt_file` instead of writing to the local filesystem. Local files in E2B sandboxes are destroyed when the sandbox stops. Convex storage persists forever.

### Your prompt files

- `IDENTITY.md` — Who you are and how you operate
- `SOUL.md` — Your personality, boundaries, and tone
- `TOOLS.md` — This file (tool reference)
- `USER.md` — Context template filled at startup
- `skills/*.md` — CLI skill references (gh, gws, etc.)

## Filesystem Tools (always available)

These work in both local mode (user's Mac) and cloud mode (E2B sandbox).

### read_file
Read the contents of a file.
- `path` (string, required): Absolute file path

### list_directory
List files and directories at a path.
- `path` (string, required): Absolute directory path

### search_files
Search file contents using ripgrep.
- `pattern` (string, required): Search pattern (regex)
- `path` (string, optional): Directory to search in (default: home directory)
- `glob` (string, optional): File glob filter (e.g. "*.ts")

### write_file
Write content to a file in the output directory.
- `path` (string, required): File path (relative to output directory)
- `content` (string, required): File content

### run_command
Execute a shell command.
- `command` (string, required): The command to run
- `cwd` (string, optional): Working directory

# Strategy

1. Start with `get_source_stats` to understand what data is available.
2. Use `search_semantic` for broad queries ("what was I working on last week?").
3. Use `search_exact` for specific lookups ("messages from Alice about deployment").
4. Use `get_recent_items` for time-based queries ("latest GitHub notifications").
5. Use `browse_items` when you need to paginate through a lot of items.
6. Use `get_item_detail` to get full content when search results are truncated.

# Skills Directory

Skill files are stored in Convex under the `skills/` prefix. Use `list_prompt_files` to see what's available, and `get_prompt_file` to read a skill.

Available skills:
- `skills/github.md` — `gh` CLI for GitHub: issues, PRs, notifications, search
- `skills/gmail.md` — `gws` CLI for Gmail: messages, drafts, labels, search
- `skills/calendar.md` — `gws` CLI for Google Calendar: events, availability

To use a skill: read it with `get_prompt_file`, then use `run_command` to execute the CLI commands it describes. You can also create new skills with `update_prompt_file`.
