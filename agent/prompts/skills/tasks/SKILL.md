# Google Tasks — gws CLI Reference

Use `run_command` to execute these. Requires `gws auth login` with Tasks scope.

## List Task Lists

```bash
gws tasks tasklists list
```

## List Tasks

`tasklist` is **required**. Use `"@default"` for the user's default list, or a specific list ID from `tasklists list`.

```bash
# All tasks from default list
gws tasks tasks list --params '{"tasklist": "@default"}'

# Include completed/hidden tasks
gws tasks tasks list --params '{"tasklist": "@default", "showCompleted": true, "showHidden": true}'

# Table format
gws tasks tasks list --params '{"tasklist": "@default"}' --format table

# From a specific list
gws tasks tasks list --params '{"tasklist": "<TASKLIST_ID>"}'
```

## Get Task Details

```bash
gws tasks tasks get --params '{"tasklist": "@default", "task": "<TASK_ID>"}'
```

## Create Tasks

```bash
# Simple task
gws tasks tasks insert --params '{"tasklist": "@default"}' --json '{
  "title": "Buy groceries"
}'

# Task with notes and due date
gws tasks tasks insert --params '{"tasklist": "@default"}' --json '{
  "title": "Submit report",
  "notes": "Include Q1 metrics",
  "due": "2026-04-10T00:00:00Z"
}'

# Subtask (nested under a parent task)
gws tasks tasks insert --params '{"tasklist": "@default", "parent": "<PARENT_TASK_ID>"}' --json '{
  "title": "Buy milk"
}'
```

## Update Tasks

```bash
# Mark as completed
gws tasks tasks patch --params '{"tasklist": "@default", "task": "<TASK_ID>"}' --json '{
  "status": "completed"
}'

# Mark as not completed
gws tasks tasks patch --params '{"tasklist": "@default", "task": "<TASK_ID>"}' --json '{
  "status": "needsAction"
}'

# Update title and notes
gws tasks tasks patch --params '{"tasklist": "@default", "task": "<TASK_ID>"}' --json '{
  "title": "Updated title",
  "notes": "Updated notes"
}'

# Set/change due date
gws tasks tasks patch --params '{"tasklist": "@default", "task": "<TASK_ID>"}' --json '{
  "due": "2026-04-15T00:00:00Z"
}'
```

## Move Tasks

```bash
# Move to top of list
gws tasks tasks move --params '{"tasklist": "@default", "task": "<TASK_ID>"}'

# Move after a specific task
gws tasks tasks move --params '{"tasklist": "@default", "task": "<TASK_ID>", "previous": "<OTHER_TASK_ID>"}'

# Move to a different list
gws tasks tasks move --params '{"tasklist": "<NEW_TASKLIST_ID>", "task": "<TASK_ID>"}'
```

## Delete Tasks

```bash
gws tasks tasks delete --params '{"tasklist": "@default", "task": "<TASK_ID>"}'
```

## Clear Completed Tasks

```bash
gws tasks tasks clear --params '{"tasklist": "@default"}'
```

## Create/Delete Task Lists

```bash
# Create a new list
gws tasks tasklists insert --json '{"title": "Shopping"}'

# Delete a list
gws tasks tasklists delete --params '{"tasklist": "<TASKLIST_ID>"}'

# Rename a list
gws tasks tasklists patch --params '{"tasklist": "<TASKLIST_ID>"}' --json '{"title": "New Name"}'
```

## Tips

- `tasklist` is required for all `tasks tasks` commands. Use `"@default"` for the default list.
- Get task list IDs from `tasklists list`. Get task IDs from `tasks list`.
- Task status is either `"needsAction"` or `"completed"`.
- Due dates use RFC 3339 format but only the date portion matters (time is ignored).
- Use `--format table` for human-readable output.
- Max 1024 characters for title, 8192 for notes.
