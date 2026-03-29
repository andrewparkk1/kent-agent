import { v } from "convex/values";
import { query, mutation } from "./_generated/server";
import { getUserByToken } from "./auth";

/**
 * Save encrypted API keys blob for a user.
 * The blob is encrypted client-side with AES-256-GCM derived from the device token.
 */
export const saveKeys = mutation({
  args: {
    deviceToken: v.string(),
    encryptedBlob: v.string(),
  },
  handler: async (ctx, args) => {
    const user = await getUserByToken(ctx, args.deviceToken);
    await ctx.db.patch(user._id, {
      encryptedKeys: args.encryptedBlob,
    });
    return { success: true };
  },
});

/**
 * Retrieve encrypted API keys blob for a user.
 * The blob must be decrypted client-side.
 */
export const getKeys = query({
  args: {
    deviceToken: v.string(),
  },
  handler: async (ctx, args) => {
    const user = await getUserByToken(ctx, args.deviceToken);
    return { encryptedBlob: user.encryptedKeys ?? null };
  },
});
