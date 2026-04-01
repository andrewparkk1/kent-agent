# Google Calendar — gws CLI Reference

Use `run_command` to execute these. Requires `gws auth login` (already done).

## List Events

```bash
# List upcoming events (default: next 7 days)
gws calendar events list

# List events for a specific date range
gws calendar events list --timeMin "2024-01-15T00:00:00Z" --timeMax "2024-01-22T00:00:00Z"

# List events from a specific calendar
gws calendar events list --calendarId "primary"

# Limit results
gws calendar events list --maxResults 5

# Search events by text
gws calendar events list --q "standup"
```

## Get Event Details

```bash
# Get a specific event by ID
gws calendar events get --calendarId "primary" --eventId <id>
```

## List Calendars

```bash
# List all calendars the user has access to
gws calendar calendarList list
```

## Tips

- Dates use ISO 8601 format with timezone: `2024-01-15T09:00:00-08:00`
- The default calendar ID is `"primary"`.
- Use `--q` for text search within events (title, description, location).
- Event IDs from `list` are needed for `get`.
- To check availability, list events for the time range and look for gaps.
- Meeting notes from Granola are in the memory system, not in calendar — use `search_semantic` for meeting content.
