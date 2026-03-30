import { v } from "convex/values";
import { query, mutation } from "./_generated/server";
import { getUserByToken } from "./auth";

/**
 * Create a new thread.
 */
export const create = mutation({
  args: {
    deviceToken: v.string(),
    channel: v.string(),
    channelId: v.optional(v.string()),
    title: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await getUserByToken(ctx, args.deviceToken);
    const now = Date.now();

    return await ctx.db.insert("threads", {
      userId: user._id,
      channel: args.channel,
      channelId: args.channelId,
      title: args.title,
      createdAt: now,
      lastMessageAt: now,
    });
  },
});

/**
 * Get the most recent thread for a user, optionally filtered by channel.
 */
export const getRecent = query({
  args: {
    deviceToken: v.string(),
    channel: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const user = await getUserByToken(ctx, args.deviceToken);
    const limit = args.limit ?? 10;

    const threads = await ctx.db
      .query("threads")
      .withIndex("by_userId_and_lastMessageAt", (q) => q.eq("userId", user._id))
      .order("desc")
      .take(limit);

    if (args.channel) {
      return threads.filter((t) => t.channel === args.channel);
    }
    return threads;
  },
});

/**
 * Get or create a thread for a specific channel + channelId combo.
 * Useful for Telegram where each user/chat should have a persistent thread.
 */
export const getOrCreate = mutation({
  args: {
    deviceToken: v.string(),
    channel: v.string(),
    channelId: v.string(),
  },
  handler: async (ctx, args) => {
    const user = await getUserByToken(ctx, args.deviceToken);

    const existing = await ctx.db
      .query("threads")
      .withIndex("by_userId_and_channel_and_channelId", (q) =>
        q
          .eq("userId", user._id)
          .eq("channel", args.channel)
          .eq("channelId", args.channelId),
      )
      .first();

    if (existing) {
      return existing._id;
    }

    const now = Date.now();
    return await ctx.db.insert("threads", {
      userId: user._id,
      channel: args.channel,
      channelId: args.channelId,
      createdAt: now,
      lastMessageAt: now,
    });
  },
});

/**
 * Add a message to a thread.
 */
export const addMessage = mutation({
  args: {
    deviceToken: v.string(),
    threadId: v.id("threads"),
    role: v.string(),
    content: v.string(),
    toolName: v.optional(v.string()),
    toolArgs: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    const user = await getUserByToken(ctx, args.deviceToken);
    const thread = await ctx.db.get(args.threadId);

    if (!thread || thread.userId !== user._id) {
      throw new Error("Thread not found or access denied");
    }

    const now = Date.now();

    // Update thread's lastMessageAt
    await ctx.db.patch(args.threadId, { lastMessageAt: now });

    // Auto-set title from first user message if not set
    if (!thread.title && args.role === "user") {
      const title =
        args.content.length > 60
          ? args.content.slice(0, 57) + "..."
          : args.content;
      await ctx.db.patch(args.threadId, { title });
    }

    return await ctx.db.insert("messages", {
      threadId: args.threadId,
      role: args.role,
      content: args.content,
      toolName: args.toolName,
      toolArgs: args.toolArgs,
      createdAt: now,
    });
  },
});

/**
 * Get all messages for a thread, ordered by createdAt.
 */
export const getMessages = query({
  args: {
    deviceToken: v.string(),
    threadId: v.id("threads"),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const user = await getUserByToken(ctx, args.deviceToken);
    const thread = await ctx.db.get(args.threadId);

    if (!thread || thread.userId !== user._id) {
      throw new Error("Thread not found or access denied");
    }

    const limit = args.limit ?? 100;

    return await ctx.db
      .query("messages")
      .withIndex("by_thread_and_createdAt", (q) =>
        q.eq("threadId", args.threadId),
      )
      .order("asc")
      .take(limit);
  },
});

/**
 * Update a thread's title.
 */
export const updateTitle = mutation({
  args: {
    deviceToken: v.string(),
    threadId: v.id("threads"),
    title: v.string(),
  },
  handler: async (ctx, args) => {
    const user = await getUserByToken(ctx, args.deviceToken);
    const thread = await ctx.db.get(args.threadId);

    if (!thread || thread.userId !== user._id) {
      throw new Error("Thread not found or access denied");
    }

    await ctx.db.patch(args.threadId, { title: args.title });
    return { success: true };
  },
});
