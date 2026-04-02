# Google Calendar — gws CLI Reference

Use `run_command` to execute these. Requires `gws auth login`.

If a command fails with an auth/token error, run `gws auth login -s gmail,calendar,tasks,drive,docs,sheets,slides` via `run_command` and retry.

## View Agenda (Preferred)

```bash
# Upcoming events across all calendars
gws calendar +agenda

# Today's events
gws calendar +agenda --today

# This week
gws calendar +agenda --week

# Next N days
gws calendar +agenda --days 3

# Filter to a specific calendar
gws calendar +agenda --calendar 'Work'

# Table format for readable output
gws calendar +agenda --today --format table

# Override timezone
gws calendar +agenda --today --timezone America/New_York
```

## Create Events (Preferred)

```bash
# Simple event
gws calendar +insert --summary 'Standup' --start '2026-04-05T09:00:00-07:00' --end '2026-04-05T09:30:00-07:00'

# With location and description
gws calendar +insert --summary 'Team Meeting' --start '2026-04-05T10:00:00-07:00' --end '2026-04-05T11:00:00-07:00' --location 'Conference Room A' --description 'Weekly sync'

# With attendees
gws calendar +insert --summary 'Review' --start '2026-04-05T10:00:00-07:00' --end '2026-04-05T11:00:00-07:00' --attendee alice@example.com --attendee bob@example.com

# With Google Meet link
gws calendar +insert --summary 'Remote Sync' --start '2026-04-05T10:00:00-07:00' --end '2026-04-05T11:00:00-07:00' --meet

# Different calendar
gws calendar +insert --calendar 'Work' --summary 'Focus Time' --start '2026-04-05T14:00:00-07:00' --end '2026-04-05T16:00:00-07:00'
```

## List Events (Low-level)

calendarId is **required** for all raw `events` commands.

```bash
# List upcoming events from primary calendar
gws calendar events list --params '{"calendarId": "primary"}'

# Date range
gws calendar events list --params '{"calendarId": "primary", "timeMin": "2026-04-01T00:00:00Z", "timeMax": "2026-04-07T00:00:00Z"}'

# Limit results
gws calendar events list --params '{"calendarId": "primary", "maxResults": 5}'

# Search events by text
gws calendar events list --params '{"calendarId": "primary", "q": "standup"}'
```

## Quick Add (Natural Language)

```bash
gws calendar events quickAdd --params '{"calendarId": "primary", "text": "Lunch with Alice tomorrow at noon"}'
```

## Get Event Details

```bash
gws calendar events get --params '{"calendarId": "primary", "eventId": "<EVENT_ID>"}'
```

## Update Events

```bash
# Patch (partial update) — only send fields you want to change
gws calendar events patch --params '{"calendarId": "primary", "eventId": "<EVENT_ID>"}' --json '{
  "summary": "Updated Title",
  "location": "New Location"
}'
```

## Delete Events

```bash
gws calendar events delete --params '{"calendarId": "primary", "eventId": "<EVENT_ID>"}'
```

## List Calendars

```bash
gws calendar calendarList list
```

## Tips

- **Prefer `+agenda` over `events list`** — it queries all calendars and formats output nicely.
- **Prefer `+insert` over `events insert`** — simpler flags, no JSON needed.
- For raw API calls: `--params '<JSON>'` for query parameters, `--json '<JSON>'` for request body. Do NOT use `--body`.
- Dates use ISO 8601: `2026-04-05T09:00:00-07:00` (with timezone) or `2026-04-05` (all-day).
- Default calendar ID is `"primary"`.
- Get event IDs from `+agenda` or `events list` output — needed for `get`, `patch`, `delete`.
- Use `--format table` for human-readable output.
- Meeting notes from Granola are in the memory system, not calendar — use `search_memory` for meeting content.
