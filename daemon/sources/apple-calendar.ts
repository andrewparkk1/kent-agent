/**
 * Apple Calendar — reads calendar events via AppleScript.
 *
 * Queries Calendar.app for events across all calendars within a date range,
 * extracts event details, and converts them to Items with structured metadata.
 */
import type { Source, SyncState, SyncOptions, Item } from "./types";

// ---------------------------------------------------------------------------
// AppleScript builder
// ---------------------------------------------------------------------------

/**
 * Build AppleScript to fetch events from all calendars within a date range.
 * @param daysBefore Number of days in the past to query from.
 */
function buildAppleScript(daysBefore: number): string {
  return `
tell application "Calendar"
  set output to ""
  set sep to "<<<SEP>>>"
  set delim to "<<<EVENT>>>"
  set startDate to (current date) - ${daysBefore} * days
  set endDate to (current date) + 30 * days
  repeat with cal in calendars
    set calName to name of cal
    set events_ to (every event of cal whose start date >= startDate and start date <= endDate)
    repeat with evt in events_
      try
        set uid to uid of evt
        set summ to summary of evt

        set sd to start date of evt as <<class isot>> as string
        set ed to end date of evt as <<class isot>> as string

        set loc to ""
        try
          set loc to location of evt
        end try
        if loc is missing value then set loc to ""

        set desc to ""
        try
          set desc to description of evt
        end try
        if desc is missing value then set desc to ""

        set ad to allday event of evt
        if ad then
          set adStr to "true"
        else
          set adStr to "false"
        end if

        set recur to ""
        try
          set recur to recurrence of evt
        end try
        if recur is missing value then set recur to ""

        set output to output & delim & uid & sep & summ & sep & sd & sep & ed & sep & loc & sep & desc & sep & calName & sep & adStr & sep & recur
      end try
    end repeat
  end repeat
  return output
end tell
`;
}

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

interface ParsedEvent {
  uid: string;
  summary: string;
  startDate: string;
  endDate: string;
  location: string;
  description: string;
  calendarName: string;
  allDay: boolean;
  recurrence: string;
}

function parseAppleScriptOutput(raw: string): ParsedEvent[] {
  const events: ParsedEvent[] = [];
  const chunks = raw.split("<<<EVENT>>>").filter(Boolean);

  for (const chunk of chunks) {
    const parts = chunk.split("<<<SEP>>>");
    if (parts.length < 9) continue;

    const [uid, summary, startDate, endDate, location, description, calendarName, allDayStr, recurrence] = parts;

    events.push({
      uid: uid!.trim(),
      summary: summary!.trim(),
      startDate: startDate!.trim(),
      endDate: endDate!.trim(),
      location: location!.trim(),
      description: description!.trim(),
      calendarName: calendarName!.trim(),
      allDay: allDayStr!.trim() === "true",
      recurrence: recurrence!.trim(),
    });
  }

  return events;
}

// ---------------------------------------------------------------------------
// Convert parsed events to Items
// ---------------------------------------------------------------------------

function eventsToItems(events: ParsedEvent[]): Item[] {
  return events
    .filter((e) => e.summary)
    .map((e) => {
      const contentLines: string[] = [];
      contentLines.push(e.summary);
      contentLines.push(`${e.startDate} - ${e.endDate}`);
      if (e.location) {
        contentLines.push(e.location);
      }

      const content = contentLines.join("\n");

      const startDateObj = new Date(e.startDate);
      const createdAt =
        !isNaN(startDateObj.getTime())
          ? Math.floor(startDateObj.getTime() / 1000)
          : Math.floor(Date.now() / 1000);

      return {
        source: "apple-calendar",
        externalId: `apple-calendar-${e.uid}`,
        content,
        metadata: {
          summary: e.summary,
          startDate: e.startDate,
          endDate: e.endDate,
          location: e.location,
          description: e.description,
          calendarName: e.calendarName,
          allDay: e.allDay,
          recurrence: e.recurrence || undefined,
        },
        createdAt,
      };
    });
}

// ---------------------------------------------------------------------------
// Default AppleScript runner
// ---------------------------------------------------------------------------

async function defaultRun(daysBefore: number): Promise<string> {
  const script = buildAppleScript(daysBefore);
  const proc = Bun.spawn(["osascript", "-e", script], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  await proc.exited;
  if (proc.exitCode !== 0) {
    throw new Error(`AppleScript failed (exit ${proc.exitCode}): ${stderr.slice(0, 200)}`);
  }
  return stdout;
}

// ---------------------------------------------------------------------------
// Factory + Source implementation
// ---------------------------------------------------------------------------

export interface AppleCalendarConfig {
  /** Override the AppleScript runner. Receives `daysBefore`, returns raw stdout. */
  exec?: (daysBefore: number) => Promise<string>;
  /** Override the clock (ms). */
  now?: () => number;
}

export function createAppleCalendarSource(config: AppleCalendarConfig = {}): Source {
  const runner = config.exec ?? defaultRun;
  const now = config.now ?? (() => Date.now());

  return {
    name: "apple-calendar",

    async fetchNew(state: SyncState, _options?: SyncOptions): Promise<Item[]> {
      try {
        const lastSync = state.getLastSync("apple-calendar");
        let daysBefore = 30;

        if (lastSync > 0) {
          const secondsSinceLastSync = Math.floor(now() / 1000) - lastSync;
          const daysSinceLastSync = Math.ceil(secondsSinceLastSync / 86400);
          daysBefore = Math.min(Math.max(daysSinceLastSync, 1), 365);
        }

        const stdout = await runner(daysBefore);
        const events = parseAppleScriptOutput(stdout);
        return eventsToItems(events);
      } catch (e) {
        console.warn(`[apple-calendar] Failed to fetch events: ${e}`);
        return [];
      }
    },
  };
}

export const appleCalendar: Source = createAppleCalendarSource();

// Exposed for tests
export { parseAppleScriptOutput as _parseAppleScriptOutput, eventsToItems as _eventsToItems };
