/**
 * Minimal cron expression matcher.
 * Supports: minute hour day-of-month month day-of-week
 * Values: number, *, star/n (step), comma-separated, ranges (1-5)
 */

function matchField(field: string, value: number, max: number): boolean {
  for (const part of field.split(",")) {
    // Step: */n or n/m
    if (part.includes("/")) {
      const [range, stepStr] = part.split("/");
      const step = parseInt(stepStr!, 10);
      if (isNaN(step) || step <= 0) continue;
      if (range === "*") {
        if (value % step === 0) return true;
      } else {
        const start = parseInt(range!, 10);
        if (!isNaN(start) && value >= start && (value - start) % step === 0) return true;
      }
      continue;
    }

    // Wildcard
    if (part === "*") return true;

    // Range: n-m
    if (part.includes("-")) {
      const [lo, hi] = part.split("-").map(Number);
      if (lo !== undefined && hi !== undefined && value >= lo && value <= hi) return true;
      continue;
    }

    // Exact
    if (parseInt(part, 10) === value) return true;
  }

  return false;
}

/**
 * Check if a cron expression matches a given date.
 * Expression format: "minute hour day-of-month month day-of-week"
 * Day-of-week: 0=Sunday, 1=Monday, ..., 6=Saturday
 */
/**
 * Find the next Date after `after` that matches the cron expression.
 * Brute-force checks each minute, capped at 48 hours to avoid infinite loops.
 * Returns null if no match is found within the window.
 */
export function getNextCronTime(expression: string, after: Date): Date | null {
  const maxMinutes = 48 * 60; // 48 hours
  const candidate = new Date(after.getTime());
  // Advance to the next minute boundary
  candidate.setSeconds(0, 0);
  candidate.setTime(candidate.getTime() + 60_000);

  for (let i = 0; i < maxMinutes; i++) {
    if (matchesCron(expression, candidate)) return candidate;
    candidate.setTime(candidate.getTime() + 60_000);
  }
  return null;
}

export function matchesCron(expression: string, date: Date): boolean {
  const parts = expression.trim().split(/\s+/);
  if (parts.length !== 5) return false;

  const [minute, hour, dayOfMonth, month, dayOfWeek] = parts;

  return (
    matchField(minute!, date.getMinutes(), 59) &&
    matchField(hour!, date.getHours(), 23) &&
    matchField(dayOfMonth!, date.getDate(), 31) &&
    matchField(month!, date.getMonth() + 1, 12) &&
    matchField(dayOfWeek!, date.getDay(), 6)
  );
}
