import { v } from "convex/values";
import { query, mutation } from "./_generated/server";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function getUserByToken(
  ctx: { db: any },
  deviceToken: string
) {
  const user = await ctx.db
    .query("users")
    .withIndex("by_deviceToken", (q: any) => q.eq("deviceToken", deviceToken))
    .unique();
  if (!user) throw new Error("Unknown device token");
  return user;
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

/**
 * List all prompt files for a user.
 */
export const list = query({
  args: { deviceToken: v.string() },
  handler: async (ctx, args) => {
    const user = await getUserByToken(ctx, args.deviceToken);
    const prompts = await ctx.db
      .query("agentPrompts")
      .withIndex("by_userId", (q: any) => q.eq("userId", user._id))
      .collect();
    return prompts.map((p: any) => ({
      name: p.name,
      updatedAt: p.updatedAt,
      size: p.content.length,
    }));
  },
});

/**
 * Get a single prompt file by name.
 */
export const get = query({
  args: {
    deviceToken: v.string(),
    name: v.string(),
  },
  handler: async (ctx, args) => {
    const user = await getUserByToken(ctx, args.deviceToken);
    const prompt = await ctx.db
      .query("agentPrompts")
      .withIndex("by_userId_and_name", (q: any) =>
        q.eq("userId", user._id).eq("name", args.name)
      )
      .unique();
    if (!prompt) return null;
    return { name: prompt.name, content: prompt.content, updatedAt: prompt.updatedAt };
  },
});

/**
 * Get ALL prompt files (content included) for agent startup.
 */
export const getAll = query({
  args: { deviceToken: v.string() },
  handler: async (ctx, args) => {
    const user = await getUserByToken(ctx, args.deviceToken);
    const prompts = await ctx.db
      .query("agentPrompts")
      .withIndex("by_userId", (q: any) => q.eq("userId", user._id))
      .collect();
    return prompts.map((p: any) => ({
      name: p.name,
      content: p.content,
    }));
  },
});

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

/**
 * Upsert a prompt file. Creates if not exists, updates if it does.
 */
export const upsert = mutation({
  args: {
    deviceToken: v.string(),
    name: v.string(),
    content: v.string(),
  },
  handler: async (ctx, args) => {
    const user = await getUserByToken(ctx, args.deviceToken);
    const existing = await ctx.db
      .query("agentPrompts")
      .withIndex("by_userId_and_name", (q: any) =>
        q.eq("userId", user._id).eq("name", args.name)
      )
      .unique();

    if (existing) {
      await ctx.db.patch(existing._id, {
        content: args.content,
        updatedAt: Date.now(),
      });
      return existing._id;
    } else {
      return await ctx.db.insert("agentPrompts", {
        userId: user._id,
        name: args.name,
        content: args.content,
        updatedAt: Date.now(),
      });
    }
  },
});

/**
 * Batch upsert multiple prompt files at once (used during init).
 */
export const batchUpsert = mutation({
  args: {
    deviceToken: v.string(),
    files: v.array(
      v.object({
        name: v.string(),
        content: v.string(),
      })
    ),
  },
  handler: async (ctx, args) => {
    const user = await getUserByToken(ctx, args.deviceToken);
    const now = Date.now();

    for (const file of args.files) {
      const existing = await ctx.db
        .query("agentPrompts")
        .withIndex("by_userId_and_name", (q: any) =>
          q.eq("userId", user._id).eq("name", file.name)
        )
        .unique();

      if (existing) {
        await ctx.db.patch(existing._id, {
          content: file.content,
          updatedAt: now,
        });
      } else {
        await ctx.db.insert("agentPrompts", {
          userId: user._id,
          name: file.name,
          content: file.content,
          updatedAt: now,
        });
      }
    }

    return args.files.length;
  },
});

/**
 * Delete a prompt file.
 */
export const remove = mutation({
  args: {
    deviceToken: v.string(),
    name: v.string(),
  },
  handler: async (ctx, args) => {
    const user = await getUserByToken(ctx, args.deviceToken);
    const existing = await ctx.db
      .query("agentPrompts")
      .withIndex("by_userId_and_name", (q: any) =>
        q.eq("userId", user._id).eq("name", args.name)
      )
      .unique();

    if (!existing) throw new Error(`Prompt file "${args.name}" not found`);
    await ctx.db.delete(existing._id);
  },
});
