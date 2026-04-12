/**
 * Apple Reminders — reads reminders via AppleScript.
 *
 * Iterates all reminder lists, extracts both completed and incomplete reminders,
 * and converts them to Items with structured metadata.
 */
import type { Source, SyncState, SyncOptions, Item } from "./types";

// ---------------------------------------------------------------------------
// AppleScript builder
// ---------------------------------------------------------------------------

/**
 * Build AppleScript to fetch all reminders from all lists.
 * The script is a static template — no user input is interpolated.
 */
function buildAppleScript(): string {
  return `
tell application "Reminders"
  set output to ""
  set fieldSep to "<<<SEP>>>"
  set recSep to "<<<REM>>>"
  repeat with reminderList in lists
    set listName to name of reminderList
    repeat with rem in reminders of reminderList
      try
        set remName to name of rem
        set remId to id of rem

        set remBody to ""
        try
          set remBody to body of rem
        end try
        if remBody is missing value then set remBody to ""

        set remDueDate to ""
        try
          set remDueDate to due date of rem as «class isot» as string
        end try
        if remDueDate is missing value then set remDueDate to ""

        set remCompletionDate to ""
        try
          set remCompletionDate to completion date of rem as «class isot» as string
        end try
        if remCompletionDate is missing value then set remCompletionDate to ""

        set remCompleted to completed of rem
        if remCompleted then
          set remCompletedStr to "true"
        else
          set remCompletedStr to "false"
        end if

        set remPriority to 0
        try
          set remPriority to priority of rem
        end try

        set remCreationDate to ""
        try
          set remCreationDate to creation date of rem as «class isot» as string
        end try
        if remCreationDate is missing value then set remCreationDate to ""

        set remModDate to ""
        try
          set remModDate to modification date of rem as «class isot» as string
        end try
        if remModDate is missing value then set remModDate to ""

        set output to output & recSep & remId & fieldSep & remName & fieldSep & remBody & fieldSep & remDueDate & fieldSep & remCompletionDate & fieldSep & remCompletedStr & fieldSep & (remPriority as string) & fieldSep & listName & fieldSep & remCreationDate & fieldSep & remModDate
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

interface ParsedReminder {
  id: string;
  name: string;
  body: string;
  dueDate: string;
  completionDate: string;
  completed: boolean;
  priority: number;
  list: string;
  createdAt: string;
  modifiedAt: string;
}

function parseAppleScriptOutput(raw: string): ParsedReminder[] {
  const reminders: ParsedReminder[] = [];
  const chunks = raw.split("<<<REM>>>").filter(Boolean);

  for (const chunk of chunks) {
    const parts = chunk.split("<<<SEP>>>");
    if (parts.length < 10) continue;

    const [id, name, body, dueDate, completionDate, completedStr, priorityStr, list, createdAt, modifiedAt] = parts;

    reminders.push({
      id: id!.trim(),
      name: name!.trim(),
      body: body!.trim(),
      dueDate: dueDate!.trim(),
      completionDate: completionDate!.trim(),
      completed: completedStr!.trim() === "true",
      priority: parseInt(priorityStr!.trim(), 10) || 0,
      list: list!.trim(),
      createdAt: createdAt!.trim(),
      modifiedAt: modifiedAt!.trim(),
    });
  }

  return reminders;
}

// ---------------------------------------------------------------------------
// Priority label helper
// ---------------------------------------------------------------------------

function priorityLabel(priority: number): string | null {
  // Apple Reminders priority: 0 = none, 1 = high, 5 = medium, 9 = low
  switch (priority) {
    case 1:
      return "high";
    case 5:
      return "medium";
    case 9:
      return "low";
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Convert parsed reminders to Items
// ---------------------------------------------------------------------------

function remindersToItems(reminders: ParsedReminder[], nowMs: number): Item[] {
  return reminders
    .filter((r) => r.name)
    .map((r) => {
      const lines: string[] = [];

      lines.push(`# ${r.name}`);
      lines.push(`List: ${r.list}`);

      if (r.completed) {
        lines.push("Status: completed");
      } else {
        lines.push("Status: incomplete");
      }

      const pLabel = priorityLabel(r.priority);
      if (pLabel) {
        lines.push(`Priority: ${pLabel}`);
      }

      if (r.dueDate) {
        lines.push(`Due: ${r.dueDate}`);
      }

      if (r.completionDate) {
        lines.push(`Completed: ${r.completionDate}`);
      }

      if (r.body) {
        lines.push("");
        lines.push(r.body);
      }

      const content = lines.join("\n");

      const createdDate = r.createdAt ? new Date(r.createdAt) : null;
      const createdAt =
        createdDate && !isNaN(createdDate.getTime())
          ? Math.floor(createdDate.getTime() / 1000)
          : Math.floor(nowMs / 1000);

      const modifiedDate = r.modifiedAt ? new Date(r.modifiedAt) : null;
      const modifiedAt =
        modifiedDate && !isNaN(modifiedDate.getTime())
          ? Math.floor(modifiedDate.getTime() / 1000)
          : null;

      const dueDate = r.dueDate ? new Date(r.dueDate) : null;
      const dueDateEpoch =
        dueDate && !isNaN(dueDate.getTime())
          ? Math.floor(dueDate.getTime() / 1000)
          : null;

      const completionDate = r.completionDate ? new Date(r.completionDate) : null;
      const completionDateEpoch =
        completionDate && !isNaN(completionDate.getTime())
          ? Math.floor(completionDate.getTime() / 1000)
          : null;

      return {
        source: "apple-reminders",
        externalId: r.id || `apple-reminders-${r.name}`,
        content,
        metadata: {
          name: r.name,
          list: r.list,
          completed: r.completed,
          priority: r.priority,
          priorityLabel: pLabel,
          dueDate: dueDateEpoch,
          completionDate: completionDateEpoch,
          modifiedAt,
        },
        createdAt,
      };
    });
}

// ---------------------------------------------------------------------------
// Source implementation
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Default AppleScript runner
// ---------------------------------------------------------------------------

async function defaultRun(): Promise<string> {
  const script = buildAppleScript();
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

export interface AppleRemindersConfig {
  /** Override the AppleScript runner — returns raw stdout. */
  exec?: () => Promise<string>;
  /** Override the clock (ms). */
  now?: () => number;
}

export function createAppleRemindersSource(config: AppleRemindersConfig = {}): Source {
  const runner = config.exec ?? defaultRun;
  const now = config.now ?? (() => Date.now());

  return {
    name: "apple-reminders",

    async fetchNew(_state: SyncState, _options?: SyncOptions): Promise<Item[]> {
      try {
        const stdout = await runner();
        const reminders = parseAppleScriptOutput(stdout);
        return remindersToItems(reminders, now());
      } catch (e) {
        console.warn(`[apple-reminders] Failed to fetch reminders: ${e}`);
        return [];
      }
    },
  };
}

export const appleReminders: Source = createAppleRemindersSource();

// Exposed for tests
export {
  parseAppleScriptOutput as _parseAppleScriptOutput,
  remindersToItems as _remindersToItems,
};
