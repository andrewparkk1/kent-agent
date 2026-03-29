import { mutation } from "./_generated/server";
import { v } from "convex/values";
import type { QueryCtx, MutationCtx, ActionCtx } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";

/**
 * Look up a user by their device token. Throws if not found.
 */
export async function getUserByToken(
  ctx: QueryCtx | MutationCtx,
  deviceToken: string
): Promise<Doc<"users">> {
  const user = await ctx.db
    .query("users")
    .withIndex("by_deviceToken", (q) => q.eq("deviceToken", deviceToken))
    .unique();

  if (!user) {
    throw new Error(`No user found for device token`);
  }

  return user;
}

/**
 * Variant for actions that need to call an internal query to resolve the user.
 * Actions don't have direct db access, so the caller must pass the resolved user
 * or use ctx.runQuery with an internal query.
 */
export type UserDoc = Doc<"users">;

/**
 * Register a new device or update an existing one.
 * Called by `kent init` to store the encrypted API keys.
 */
export const registerDevice = mutation({
  args: {
    deviceToken: v.string(),
    encryptedKeys: v.string(),
    encryptionSalt: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("users")
      .withIndex("by_deviceToken", (q) => q.eq("deviceToken", args.deviceToken))
      .unique();

    if (existing) {
      const patch: Record<string, string> = { encryptedKeys: args.encryptedKeys };
      if (args.encryptionSalt) patch.encryptionSalt = args.encryptionSalt;
      await ctx.db.patch(existing._id, patch);
      return existing._id;
    }

    return await ctx.db.insert("users", {
      deviceToken: args.deviceToken,
      encryptedKeys: args.encryptedKeys,
      encryptionSalt: args.encryptionSalt,
      createdAt: Date.now(),
    });
  },
});
