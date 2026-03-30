import { v } from "convex/values";
import { query, mutation } from "./_generated/server";
import { getUserByToken } from "./auth";

/**
 * Create a new run.
 */
export const create = mutation({
  args: {
    deviceToken: v.string(),
    workflowId: v.optional(v.id("workflows")),
    prompt: v.string(),
  },
  handler: async (ctx, args) => {
    const user = await getUserByToken(ctx, args.deviceToken);

    return await ctx.db.insert("runs", {
      userId: user._id,
      workflowId: args.workflowId,
      prompt: args.prompt,
      status: "running",
      startedAt: Date.now(),
    });
  },
});

/**
 * Mark a run as finished successfully.
 */
export const finish = mutation({
  args: {
    deviceToken: v.string(),
    runId: v.id("runs"),
    output: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await getUserByToken(ctx, args.deviceToken);
    const run = await ctx.db.get(args.runId);

    if (!run || run.userId !== user._id) {
      throw new Error("Run not found or access denied");
    }

    await ctx.db.patch(args.runId, {
      status: "completed",
      output: args.output,
      finishedAt: Date.now(),
    });
    return { success: true };
  },
});

/**
 * Mark a run as failed.
 */
export const fail = mutation({
  args: {
    deviceToken: v.string(),
    runId: v.id("runs"),
    error: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await getUserByToken(ctx, args.deviceToken);
    const run = await ctx.db.get(args.runId);

    if (!run || run.userId !== user._id) {
      throw new Error("Run not found or access denied");
    }

    await ctx.db.patch(args.runId, {
      status: `failed${args.error ? `: ${args.error}` : ""}`,
      finishedAt: Date.now(),
    });
    return { success: true };
  },
});

/**
 * Append a message to a run.
 */
export const addMessage = mutation({
  args: {
    deviceToken: v.string(),
    runId: v.id("runs"),
    role: v.string(),
    content: v.string(),
    toolName: v.optional(v.string()),
    toolArgs: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    const user = await getUserByToken(ctx, args.deviceToken);
    const run = await ctx.db.get(args.runId);

    if (!run || run.userId !== user._id) {
      throw new Error("Run not found or access denied");
    }

    return await ctx.db.insert("messages", {
      runId: args.runId,
      role: args.role,
      content: args.content,
      toolName: args.toolName,
      toolArgs: args.toolArgs,
      createdAt: Date.now(),
    });
  },
});

/**
 * Get all messages for a run, ordered by createdAt.
 */
export const getMessages = query({
  args: {
    deviceToken: v.string(),
    runId: v.id("runs"),
  },
  handler: async (ctx, args) => {
    const user = await getUserByToken(ctx, args.deviceToken);
    const run = await ctx.db.get(args.runId);

    if (!run || run.userId !== user._id) {
      throw new Error("Run not found or access denied");
    }

    return await ctx.db
      .query("messages")
      .withIndex("by_run_and_createdAt", (q) => q.eq("runId", args.runId))
      .collect();
  },
});
