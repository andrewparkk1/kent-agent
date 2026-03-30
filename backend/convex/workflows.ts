import { v } from "convex/values";
import { query, mutation } from "./_generated/server";
import { getUserByToken } from "./auth";

/**
 * Create or update a workflow by name.
 */
export const upsert = mutation({
  args: {
    deviceToken: v.string(),
    name: v.string(),
    prompt: v.string(),
    runner: v.optional(v.string()),
    cronSchedule: v.optional(v.string()),
    triggerSource: v.optional(v.string()),
    enabled: v.boolean(),
  },
  handler: async (ctx, args) => {
    const user = await getUserByToken(ctx, args.deviceToken);

    // Check for existing workflow with this name
    const existing = await ctx.db
      .query("workflows")
      .withIndex("by_userId", (q) => q.eq("userId", user._id))
      .filter((q) => q.eq(q.field("name"), args.name))
      .unique();

    const data = {
      userId: user._id,
      name: args.name,
      prompt: args.prompt,
      runner: args.runner,
      cronSchedule: args.cronSchedule,
      triggerSource: args.triggerSource,
      enabled: args.enabled,
    };

    if (existing) {
      await ctx.db.patch(existing._id, data);
      return existing._id;
    } else {
      return await ctx.db.insert("workflows", data);
    }
  },
});

/**
 * List all workflows for a user.
 */
export const list = query({
  args: {
    deviceToken: v.string(),
  },
  handler: async (ctx, args) => {
    const user = await getUserByToken(ctx, args.deviceToken);
    return await ctx.db
      .query("workflows")
      .withIndex("by_userId", (q) => q.eq("userId", user._id))
      .collect();
  },
});

/**
 * Get a workflow by name for a user.
 */
export const getByName = query({
  args: {
    deviceToken: v.string(),
    name: v.string(),
  },
  handler: async (ctx, args) => {
    const user = await getUserByToken(ctx, args.deviceToken);
    return await ctx.db
      .query("workflows")
      .withIndex("by_userId", (q) => q.eq("userId", user._id))
      .filter((q) => q.eq(q.field("name"), args.name))
      .unique();
  },
});

/**
 * Enable or disable a workflow by ID.
 */
export const setEnabled = mutation({
  args: {
    deviceToken: v.string(),
    workflowId: v.id("workflows"),
    enabled: v.boolean(),
  },
  handler: async (ctx, args) => {
    const user = await getUserByToken(ctx, args.deviceToken);
    const workflow = await ctx.db.get(args.workflowId);

    if (!workflow || workflow.userId !== user._id) {
      throw new Error("Workflow not found or access denied");
    }

    await ctx.db.patch(args.workflowId, { enabled: args.enabled });
    return { success: true };
  },
});

/**
 * Disable a workflow by name (used by CLI `kent workflow disable <name>`).
 */
export const disable = mutation({
  args: {
    deviceToken: v.string(),
    name: v.string(),
  },
  handler: async (ctx, args) => {
    const user = await getUserByToken(ctx, args.deviceToken);

    const workflow = await ctx.db
      .query("workflows")
      .withIndex("by_userId", (q) => q.eq("userId", user._id))
      .filter((q) => q.eq(q.field("name"), args.name))
      .unique();

    if (!workflow) {
      throw new Error(`Workflow "${args.name}" not found`);
    }

    await ctx.db.patch(workflow._id, { enabled: false });
    return { id: workflow._id, name: workflow.name };
  },
});

/**
 * Get all enabled workflows (used by cron tick to find due workflows).
 */
export const getEnabled = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db
      .query("workflows")
      .filter((q) => q.eq(q.field("enabled"), true))
      .collect();
  },
});
