# Gmail — gws CLI Reference

Use `run_command` to execute these. Requires `gws auth login` (already done).

## List Messages

```bash
# List recent messages
gws gmail messages list

# List with a search query (same syntax as Gmail search)
gws gmail messages list --query "from:alice@example.com"
gws gmail messages list --query "subject:deployment after:2024/01/01"
gws gmail messages list --query "is:unread"
gws gmail messages list --query "label:important"

# Limit results
gws gmail messages list --maxResults 10
```

## Read a Message

```bash
# Get message by ID (from list output)
gws gmail messages get --messageId <id>
```

## Create a Draft

```bash
# Create a draft (does NOT send)
gws gmail drafts create --to "alice@example.com" --subject "Subject" --body "Body text"

# Create a reply draft
gws gmail drafts create --to "alice@example.com" --subject "Re: Original" --body "Reply text" --threadId <id>
```

## Labels

```bash
# List all labels
gws gmail labels list

# Apply a label to a message
gws gmail messages modify --messageId <id> --addLabelIds LABEL_ID
```

## Search Syntax

Gmail search operators work in the `--query` flag:
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

- Always check the draft before asking to send. Create drafts, not sent messages.
- Use `--query` with Gmail search syntax for filtering.
- Message IDs from `list` are needed for `get` and `modify`.
