import { v } from "convex/values";
import {
  internalAction,
  internalMutation,
  internalQuery,
} from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";

// Max items per OpenAI embedding batch request
const EMBED_BATCH_SIZE = 100;
// Max content length per item (truncate to stay within token limits)
const MAX_CONTENT_LENGTH = 8000;

// ── Internal: get items that need embedding ────────────────────────────
export const getItemsWithoutEmbedding = internalQuery({
  args: { limit: v.number() },
  handler: async (ctx, args) => {
    // Scan items, return those without embeddings
    const items = await ctx.db.query("items").take(args.limit * 5);
    return items
      .filter((item) => !item.embedding || item.embedding.length === 0)
      .slice(0, args.limit)
      .map((item) => ({
        _id: item._id,
        content: item.content.slice(0, MAX_CONTENT_LENGTH),
      }));
  },
});

// ── Internal: get specific items' content for embedding ────────────────
export const getItemsContent = internalQuery({
  args: { ids: v.array(v.id("items")) },
  handler: async (ctx, args) => {
    const results = [];
    for (const id of args.ids) {
      const item = await ctx.db.get(id);
      if (item && (!item.embedding || item.embedding.length === 0)) {
        results.push({
          _id: item._id,
          content: item.content.slice(0, MAX_CONTENT_LENGTH),
        });
      }
    }
    return results;
  },
});

// ── Internal: patch embeddings onto items ──────────────────────────────
export const patchEmbeddings = internalMutation({
  args: {
    patches: v.array(
      v.object({
        id: v.id("items"),
        embedding: v.array(v.number()),
      })
    ),
  },
  handler: async (ctx, args) => {
    for (const patch of args.patches) {
      await ctx.db.patch(patch.id, { embedding: patch.embedding });
    }
    return { patched: args.patches.length };
  },
});

// ── Shared: call OpenAI embeddings API ────────────────────────────────
async function callOpenAIEmbeddings(
  texts: string[]
): Promise<number[][]> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error(
      "OPENAI_API_KEY not configured. Set it in Convex environment variables."
    );
  }

  const response = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "text-embedding-3-small",
      input: texts,
    }),
  });

  if (!response.ok) {
    throw new Error(
      `OpenAI embedding request failed: ${response.statusText}`
    );
  }

  const data = await response.json();
  // OpenAI returns embeddings in the same order as input
  return data.data.map((d: { embedding: number[] }) => d.embedding);
}

// ── Action: embed specific items (called after batchUpsert) ───────────
export const embedItems = internalAction({
  args: { ids: v.array(v.id("items")) },
  handler: async (ctx, args) => {
    if (args.ids.length === 0) return { embedded: 0 };

    // Fetch content for items that still need embedding
    const items: Array<{ _id: Id<"items">; content: string }> =
      await ctx.runQuery(internal.embeddings.getItemsContent, {
        ids: args.ids,
      });

    if (items.length === 0) return { embedded: 0 };

    let totalEmbedded = 0;

    // Process in batches
    for (let i = 0; i < items.length; i += EMBED_BATCH_SIZE) {
      const batch = items.slice(i, i + EMBED_BATCH_SIZE);
      const texts = batch.map((item) => item.content || " ");

      try {
        const embeddings = await callOpenAIEmbeddings(texts);

        const patches = batch.map((item, idx) => ({
          id: item._id,
          embedding: embeddings[idx],
        }));

        await ctx.runMutation(internal.embeddings.patchEmbeddings, {
          patches,
        });
        totalEmbedded += patches.length;
      } catch (e) {
        console.error(
          `[embeddings] Failed to embed batch starting at ${i}: ${e}`
        );
        // Continue with next batch
      }
    }

    return { embedded: totalEmbedded };
  },
});

// ── Action: backfill embeddings for items that don't have them ─────────
export const backfillEmbeddings = internalAction({
  args: {},
  handler: async (ctx) => {
    // Get a batch of items without embeddings
    const items: Array<{ _id: Id<"items">; content: string }> =
      await ctx.runQuery(internal.embeddings.getItemsWithoutEmbedding, {
        limit: EMBED_BATCH_SIZE,
      });

    if (items.length === 0) {
      return { embedded: 0, remaining: false };
    }

    const texts = items.map((item) => item.content || " ");

    try {
      const embeddings = await callOpenAIEmbeddings(texts);

      const patches = items.map((item, idx) => ({
        id: item._id,
        embedding: embeddings[idx],
      }));

      await ctx.runMutation(internal.embeddings.patchEmbeddings, {
        patches,
      });

      // If we got a full batch, there are probably more
      const remaining = items.length === EMBED_BATCH_SIZE;
      if (remaining) {
        // Schedule another round immediately
        await ctx.scheduler.runAfter(
          0,
          internal.embeddings.backfillEmbeddings,
          {}
        );
      }

      return { embedded: patches.length, remaining };
    } catch (e) {
      console.error(`[embeddings] Backfill failed: ${e}`);
      return { embedded: 0, remaining: true };
    }
  },
});
