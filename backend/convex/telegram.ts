import { mutation, query, internalQuery } from "./_generated/server";
import { v } from "convex/values";

/**
 * linkDevice — called by the Telegram bot when a user taps /start with a deep link.
 *
 * The deep link URL is: https://t.me/kent_personal_bot?start=<deviceToken>
 * When the bot receives /start <deviceToken>, it calls this mutation to associate
 * the Telegram user with the Kent device.
 */
export const linkDevice = mutation({
  args: {
    deviceToken: v.string(),
    telegramUserId: v.number(),
    telegramUsername: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await ctx.db
      .query("users")
      .withIndex("by_deviceToken", (q) => q.eq("deviceToken", args.deviceToken))
      .unique();

    if (!user) {
      throw new Error(`No user found with device token: ${args.deviceToken}`);
    }

    await ctx.db.patch(user._id, {
      telegramUserId: args.telegramUserId,
      telegramUsername: args.telegramUsername,
    });

    return { success: true };
  },
});

/**
 * checkLink — polled by `kent init` to see if the user has tapped /start in Telegram.
 *
 * Returns { linked: false } until the bot calls linkDevice, then returns
 * { linked: true, userId, username }.
 */
export const checkLink = query({
  args: {
    deviceToken: v.string(),
  },
  handler: async (ctx, args) => {
    const user = await ctx.db
      .query("users")
      .withIndex("by_deviceToken", (q) => q.eq("deviceToken", args.deviceToken))
      .unique();

    if (!user || !user.telegramUserId) {
      return { linked: false };
    }

    return {
      linked: true,
      userId: user.telegramUserId,
      username: user.telegramUsername ?? undefined,
    };
  },
});

/**
 * Look up a user by their linked Telegram ID.
 * Internal-only — used by the agent runner action.
 */
export const getUserByTelegramId = internalQuery({
  args: {
    telegramUserId: v.number(),
  },
  handler: async (ctx, args) => {
    // No index on telegramUserId, so we scan — fine for low user count
    const users = await ctx.db.query("users").collect();
    return users.find((u) => u.telegramUserId === args.telegramUserId) ?? null;
  },
});
