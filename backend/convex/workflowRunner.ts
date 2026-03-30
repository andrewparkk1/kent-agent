import { v } from "convex/values";
import {
  internalAction,
  internalMutation,
  internalQuery,
} from "./_generated/server";
import { internal } from "./_generated/api";

/**
 * Workflow runner for Convex-scheduled workflows.
 *
 * The tick() function is called every minute by the cron system.
 * It checks all enabled workflows against their cron schedule and
 * dispatches any that are due to run.
 */

// ── tick ─────────────────────────────────────────────────────────────────
// Called by crons.ts every minute. Checks schedules and dispatches workflows.
export const tick = internalAction({
  args: {},
  handler: async (ctx) => {
    const workflows = await ctx.runQuery(
      internal.workflowRunner.getEnabledWithSchedules,
    );

    const now = new Date();

    for (const wf of workflows) {
      if (!wf.cronSchedule) continue;

      if (matchesCron(wf.cronSchedule, now)) {
        console.log(`[workflow-tick] Dispatching workflow: ${wf.name}`);

        // Create a run record
        await ctx.runMutation(internal.workflowRunner.createRun, {
          userId: wf.userId,
          workflowId: wf._id,
          prompt: wf.prompt,
        });

        // TODO: Call agent runner and broadcast output to all channels
        // For now, we create the run record. The CLI daemon or cloud runner
        // will pick up pending runs and execute them.
        console.log(
          `[workflow-tick] Created run for "${wf.name}"`,
        );
      }
    }
  },
});

// ── getEnabledWithSchedules ──────────────────────────────────────────────
export const getEnabledWithSchedules = internalQuery({
  args: {},
  handler: async (ctx) => {
    const workflows = await ctx.db
      .query("workflows")
      .filter((q) => q.eq(q.field("enabled"), true))
      .collect();

    // Only return workflows that have a cron schedule
    return workflows.filter((wf) => wf.cronSchedule);
  },
});

// ── createRun ────────────────────────────────────────────────────────────
export const createRun = internalMutation({
  args: {
    userId: v.id("users"),
    workflowId: v.id("workflows"),
    prompt: v.string(),
  },
  handler: async (ctx, args) => {
    const runId = await ctx.db.insert("runs", {
      userId: args.userId,
      workflowId: args.workflowId,
      prompt: args.prompt,
      status: "pending",
      startedAt: Date.now(),
    });
    return runId;
  },
});

// ── Cron matching utility ────────────────────────────────────────────────

/**
 * Simple cron expression matcher.
 * Supports: minute, hour, day-of-month, month, day-of-week
 * Supports: *, specific values, ranges (1-5), steps (star/5)
 *
 * This is intentionally simple — it covers the patterns used by Kent's
 * built-in workflow templates. For production use, consider a dedicated
 * cron parsing library.
 */
function matchesCron(expression: string, date: Date): boolean {
  const parts = expression.trim().split(/\s+/);
  if (parts.length !== 5) return false;

  const [minExpr, hourExpr, domExpr, monExpr, dowExpr] = parts;

  const minute = date.getMinutes();
  const hour = date.getHours();
  const dayOfMonth = date.getDate();
  const month = date.getMonth() + 1; // 1-12
  const dayOfWeek = date.getDay(); // 0=Sun, 1=Mon, ..., 6=Sat

  return (
    matchField(minExpr, minute, 0, 59) &&
    matchField(hourExpr, hour, 0, 23) &&
    matchField(domExpr, dayOfMonth, 1, 31) &&
    matchField(monExpr, month, 1, 12) &&
    matchField(dowExpr, dayOfWeek, 0, 7) // 0 and 7 both = Sunday
  );
}

function matchField(expr: string, value: number, min: number, max: number): boolean {
  // Handle comma-separated values
  if (expr.includes(",")) {
    return expr.split(",").some((part) => matchField(part.trim(), value, min, max));
  }

  // Wildcard
  if (expr === "*") return true;

  // Step: */n
  if (expr.startsWith("*/")) {
    const step = parseInt(expr.slice(2), 10);
    if (isNaN(step) || step <= 0) return false;
    return value % step === 0;
  }

  // Range: a-b
  if (expr.includes("-")) {
    const [startStr, endStr] = expr.split("-");
    const start = parseInt(startStr, 10);
    const end = parseInt(endStr, 10);
    if (isNaN(start) || isNaN(end)) return false;
    return value >= start && value <= end;
  }

  // Exact value
  const exact = parseInt(expr, 10);
  if (isNaN(exact)) return false;

  // Special case: day-of-week 7 === 0 (both Sunday)
  if (max === 7 && exact === 7) return value === 0;

  return value === exact;
}
