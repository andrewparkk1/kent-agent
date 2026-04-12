/**
 * Tests for daemon/cron.ts — pure logic, no timers.
 */
import { test, expect, describe } from "bun:test";
import { matchesCron, getNextCronTime } from "@daemon/cron.ts";

describe("matchesCron — wildcards", () => {
  test("* * * * * matches any date", () => {
    const d = new Date(2026, 3, 11, 14, 30, 0);
    expect(matchesCron("* * * * *", d)).toBe(true);
  });

  test("invalid expression with wrong field count returns false", () => {
    const d = new Date();
    expect(matchesCron("* * * *", d)).toBe(false);
    expect(matchesCron("* * * * * *", d)).toBe(false);
    expect(matchesCron("", d)).toBe(false);
  });
});

describe("matchesCron — exact values", () => {
  test("matches specific minute", () => {
    const d = new Date(2026, 3, 11, 14, 30, 0);
    expect(matchesCron("30 * * * *", d)).toBe(true);
    expect(matchesCron("31 * * * *", d)).toBe(false);
  });

  test("matches specific hour and minute", () => {
    const d = new Date(2026, 3, 11, 9, 0, 0);
    expect(matchesCron("0 9 * * *", d)).toBe(true);
    expect(matchesCron("0 10 * * *", d)).toBe(false);
  });

  test("matches day of month (1-indexed)", () => {
    const d = new Date(2026, 3, 11, 0, 0, 0); // April 11
    expect(matchesCron("0 0 11 * *", d)).toBe(true);
    expect(matchesCron("0 0 12 * *", d)).toBe(false);
  });

  test("matches month (1-indexed, April = 4)", () => {
    const d = new Date(2026, 3, 11, 0, 0, 0);
    expect(matchesCron("0 0 * 4 *", d)).toBe(true);
    expect(matchesCron("0 0 * 5 *", d)).toBe(false);
  });

  test("matches day of week (0=Sun)", () => {
    // April 11, 2026 is a Saturday (day 6)
    const d = new Date(2026, 3, 11, 0, 0, 0);
    expect(matchesCron("0 0 * * 6", d)).toBe(true);
    expect(matchesCron("0 0 * * 0", d)).toBe(false);
  });
});

describe("matchesCron — ranges", () => {
  test("hour range 9-17", () => {
    expect(matchesCron("0 9-17 * * *", new Date(2026, 0, 1, 9, 0))).toBe(true);
    expect(matchesCron("0 9-17 * * *", new Date(2026, 0, 1, 17, 0))).toBe(true);
    expect(matchesCron("0 9-17 * * *", new Date(2026, 0, 1, 8, 0))).toBe(false);
    expect(matchesCron("0 9-17 * * *", new Date(2026, 0, 1, 18, 0))).toBe(false);
  });

  test("minute range", () => {
    expect(matchesCron("0-5 * * * *", new Date(2026, 0, 1, 10, 3))).toBe(true);
    expect(matchesCron("0-5 * * * *", new Date(2026, 0, 1, 10, 6))).toBe(false);
  });
});

describe("matchesCron — comma lists", () => {
  test("comma-separated minutes", () => {
    expect(matchesCron("0,15,30,45 * * * *", new Date(2026, 0, 1, 10, 15))).toBe(true);
    expect(matchesCron("0,15,30,45 * * * *", new Date(2026, 0, 1, 10, 45))).toBe(true);
    expect(matchesCron("0,15,30,45 * * * *", new Date(2026, 0, 1, 10, 20))).toBe(false);
  });

  test("comma mixed with range", () => {
    expect(matchesCron("0,30 9-12 * * *", new Date(2026, 0, 1, 10, 30))).toBe(true);
    expect(matchesCron("0,30 9-12 * * *", new Date(2026, 0, 1, 13, 30))).toBe(false);
  });
});

describe("matchesCron — step values", () => {
  test("*/5 matches every 5 minutes", () => {
    expect(matchesCron("*/5 * * * *", new Date(2026, 0, 1, 10, 0))).toBe(true);
    expect(matchesCron("*/5 * * * *", new Date(2026, 0, 1, 10, 5))).toBe(true);
    expect(matchesCron("*/5 * * * *", new Date(2026, 0, 1, 10, 15))).toBe(true);
    expect(matchesCron("*/5 * * * *", new Date(2026, 0, 1, 10, 3))).toBe(false);
  });

  test("*/15 on hour", () => {
    expect(matchesCron("0 */6 * * *", new Date(2026, 0, 1, 0, 0))).toBe(true);
    expect(matchesCron("0 */6 * * *", new Date(2026, 0, 1, 6, 0))).toBe(true);
    expect(matchesCron("0 */6 * * *", new Date(2026, 0, 1, 12, 0))).toBe(true);
    expect(matchesCron("0 */6 * * *", new Date(2026, 0, 1, 3, 0))).toBe(false);
  });

  test("malformed step ignored (zero / NaN)", () => {
    // "*/0" should not crash or incorrectly match
    expect(matchesCron("*/0 * * * *", new Date(2026, 0, 1, 10, 0))).toBe(false);
  });

  test("offset step n/m", () => {
    // 5/10 → 5, 15, 25, 35, 45, 55
    expect(matchesCron("5/10 * * * *", new Date(2026, 0, 1, 10, 5))).toBe(true);
    expect(matchesCron("5/10 * * * *", new Date(2026, 0, 1, 10, 15))).toBe(true);
    expect(matchesCron("5/10 * * * *", new Date(2026, 0, 1, 10, 10))).toBe(false);
  });
});

describe("getNextCronTime", () => {
  test("finds next minute boundary for * * * * *", () => {
    const after = new Date(2026, 3, 11, 14, 30, 25);
    const next = getNextCronTime("* * * * *", after);
    expect(next).not.toBeNull();
    expect(next!.getMinutes()).toBe(31);
    expect(next!.getSeconds()).toBe(0);
  });

  test("finds next specific hour:minute", () => {
    const after = new Date(2026, 3, 11, 8, 0, 0);
    const next = getNextCronTime("0 9 * * *", after);
    expect(next).not.toBeNull();
    expect(next!.getHours()).toBe(9);
    expect(next!.getMinutes()).toBe(0);
  });

  test("rolls to next day if time already passed today", () => {
    const after = new Date(2026, 3, 11, 10, 0, 0);
    const next = getNextCronTime("0 9 * * *", after);
    expect(next).not.toBeNull();
    expect(next!.getDate()).toBe(12);
    expect(next!.getHours()).toBe(9);
  });

  test("returns null when nothing matches in 48h window", () => {
    // Impossible combo: day 31 of February (no such day exists)
    const after = new Date(2026, 1, 1, 0, 0, 0);
    const next = getNextCronTime("0 0 31 2 *", after);
    expect(next).toBeNull();
  });

  test("every 15 minutes starting now", () => {
    const after = new Date(2026, 3, 11, 14, 7, 0);
    const next = getNextCronTime("*/15 * * * *", after);
    expect(next).not.toBeNull();
    expect(next!.getMinutes()).toBe(15);
  });
});
