import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

/**
 * Convex cron job definitions for Kent workflows.
 *
 * Convex crons are declared statically at deploy time. Since Kent workflows
 * have dynamic schedules defined by users, we use a single "tick" cron that
 * runs frequently and checks which workflows are due.
 *
 * The tick function (defined in workflowRunner.ts) queries all enabled
 * workflows, checks their cron schedules against the current time, and
 * dispatches any that are due.
 *
 * Cron expressions reference:
 *   - "* * * * *" = every minute
 *   - "*/5 * * * *" = every 5 minutes
 *   - We use every-minute to ensure workflows fire within their schedule window.
 */
const crons = cronJobs();

// Master tick: runs every minute, checks which workflows need to fire.
// The workflowRunner.tick function handles schedule matching and dispatch.
crons.interval(
  "workflow-tick",
  { minutes: 1 },
  internal.workflowRunner.tick,
);

export default crons;
