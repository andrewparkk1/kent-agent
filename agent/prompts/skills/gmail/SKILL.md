# Gmail — gws CLI Reference

Use `run_command` to execute these. Requires `gws auth login` (already done).

## Triage (Inbox Summary)

```bash
# Show unread inbox summary (table format by default)
gws gmail +triage

# Limit results
gws gmail +triage --max 5

# Custom query
gws gmail +triage --query "from:boss"
gws gmail +triage --query "is:unread after:2026/04/01"

# Include label names
gws gmail +triage --labels

# JSON output
gws gmail +triage --format json
```

## Read a Message

```bash
# Read message body (plain text, auto-converted from HTML)
gws gmail +read --id <MESSAGE_ID>

# Include headers (From, To, Subject, Date)
gws gmail +read --id <MESSAGE_ID> --headers

# JSON output
gws gmail +read --id <MESSAGE_ID> --format json
```

## Send Email

```bash
# Send a plain text email
gws gmail +send --to "alice@example.com" --subject "Hello" --body "Hi Alice!"

# With CC/BCC
gws gmail +send --to "alice@example.com" --subject "Hello" --body "Hi!" --cc "bob@example.com"

# HTML body
gws gmail +send --to "alice@example.com" --subject "Hello" --body "<b>Bold</b> text" --html

# With attachment
gws gmail +send --to "alice@example.com" --subject "Report" --body "See attached" -a report.pdf

# Multiple attachments
gws gmail +send --to "alice@example.com" --subject "Files" --body "Two files" -a a.pdf -a b.csv

# Send from alias
gws gmail +send --to "alice@example.com" --subject "Hello" --body "Hi!" --from alias@example.com
```

## Reply

```bash
# Reply to sender only
gws gmail +reply --message-id <MESSAGE_ID> --body "Thanks, got it!"

# Reply with CC
gws gmail +reply --message-id <MESSAGE_ID> --body "Looping in Carol" --cc carol@example.com

# Reply all
gws gmail +reply-all --message-id <MESSAGE_ID> --body "Sounds good to me!"

# Reply all but exclude someone
gws gmail +reply-all --message-id <MESSAGE_ID> --body "Updated" --remove bob@example.com
```

## Forward

```bash
# Forward a message
gws gmail +forward --message-id <MESSAGE_ID> --to "dave@example.com"

# Forward with a note
gws gmail +forward --message-id <MESSAGE_ID> --to "dave@example.com" --body "FYI see below"
```

## List Messages (Low-level)

userId `"me"` is **required** for all raw `users` commands.

```bash
# List messages (returns IDs — use +read to get content)
gws gmail users messages list --params '{"userId": "me", "q": "from:alice@example.com"}'
gws gmail users messages list --params '{"userId": "me", "q": "subject:deployment after:2026/04/01"}'
gws gmail users messages list --params '{"userId": "me", "maxResults": 10}'
```

## Labels

```bash
# List all labels
gws gmail users labels list --params '{"userId": "me"}'
```

## Search Syntax

Gmail search operators work in query strings:
- `from:name` — sender
- `to:name` — recipient
- `subject:word` — subject line
- `after:YYYY/MM/DD` — date filter
- `before:YYYY/MM/DD` — date filter
- `is:unread` — unread only
- `is:starred` — starred only
- `has:attachment` — has attachments
- `label:name` — by label
- `in:inbox` / `in:sent` / `in:drafts` — by folder

## Tips

- Use `+triage` first to see inbox overview and get message IDs.
- Use `+read` to get message content by ID.
- Use `+send` to compose new emails, `+reply`/`+reply-all` for responses, `+forward` to forward.
- Helper commands (`+send`, `+reply`, etc.) handle MIME encoding, threading, and attachments automatically.
- Always confirm with the user before sending emails.
- Use `--dry-run` to preview what would be sent without actually sending.
