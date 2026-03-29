import { v } from "convex/values";
import { query, mutation, action, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";
import { getUserByToken } from "./auth";
import type { Id } from "./_generated/dataModel";

// ── batchUpsert ─────────────────────────────────────────────────────────
export const batchUpsert = mutation({
  args: {
    deviceToken: v.string(),
    items: v.array(
      v.object({
        source: v.string(),
        externalId: v.string(),
        content: v.string(),
        metadata: v.any(),
        createdAt: v.optional(v.number()),
      })
    ),
  },
  handler: async (ctx, args) => {
    const user = await getUserByToken(ctx, args.deviceToken);

    const upserted: Id<"items">[] = [];

    for (const item of args.items) {
      const existing = await ctx.db
        .query("items")
        .withIndex("by_user_source_externalId", (q) =>
          q
            .eq("userId", user._id)
            .eq("source", item.source)
            .eq("externalId", item.externalId)
        )
        .unique();

      if (existing) {
        await ctx.db.patch(existing._id, {
          content: item.content,
          metadata: item.metadata,
          indexedAt: Date.now(),
        });
        upserted.push(existing._id);
      } else {
        const id = await ctx.db.insert("items", {
          userId: user._id,
          source: item.source,
          externalId: item.externalId,
          content: item.content,
          metadata: item.metadata,
          createdAt: item.createdAt ?? Date.now(),
          indexedAt: Date.now(),
        });
        upserted.push(id);
      }
    }

    // Schedule async embedding generation for new/updated items
    if (upserted.length > 0) {
      await ctx.scheduler.runAfter(0, internal.embeddings.embedItems, {
        ids: upserted,
      });
    }

    return { upserted: upserted.length };
  },
});

// ── Internal: fetch items by IDs (used by searchSemantic action) ────────
export const fetchItemsByIds = internalQuery({
  args: { ids: v.array(v.id("items")) },
  handler: async (ctx, args) => {
    const results = [];
    for (const id of args.ids) {
      const item = await ctx.db.get(id);
      if (item) {
        const { embedding, ...rest } = item;
        results.push(rest);
      }
    }
    return results;
  },
});

// ── Internal: resolve deviceToken → userId ─────────────────────────────
export const resolveUserId = internalQuery({
  args: { deviceToken: v.string() },
  handler: async (ctx, args) => {
    const user = await getUserByToken(ctx, args.deviceToken);
    return user._id;
  },
});

// ── searchSemantic (action — OpenAI embedding + Convex vector index) ───
export const searchSemantic = action({
  args: {
    deviceToken: v.string(),
    queryText: v.string(),
    topK: v.optional(v.number()),
    source: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const topK = args.topK ?? 10;

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error(
        "OPENAI_API_KEY not configured. Set it in Convex environment variables."
      );
    }

    // Resolve userId from deviceToken
    const userId: Id<"users"> = await ctx.runQuery(
      internal.items.resolveUserId,
      { deviceToken: args.deviceToken }
    );

    // Get embedding for the query
    const embeddingResponse = await fetch(
      "https://api.openai.com/v1/embeddings",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "text-embedding-3-small",
          input: args.queryText,
        }),
      }
    );

    if (!embeddingResponse.ok) {
      throw new Error(
        `OpenAI embedding request failed: ${embeddingResponse.statusText}`
      );
    }

    const embeddingData = await embeddingResponse.json();
    const queryEmbedding: number[] = embeddingData.data[0].embedding;

    // Use Convex native vector search (filter by userId for security)
    // Fetch extra results if source-filtering, since we post-filter
    const searchLimit = args.source ? topK * 3 : topK;
    const results = await ctx.vectorSearch("items", "by_embedding", {
      vector: queryEmbedding,
      limit: searchLimit,
      filter: (q: any) => q.eq("userId", userId),
    });

    // Fetch full documents by ID
    const items: Array<Record<string, any>> = await ctx.runQuery(
      internal.items.fetchItemsByIds,
      { ids: results.map((r: any) => r._id) }
    );

    // Post-filter by source if requested
    const filtered = args.source
      ? items.filter((item) => item.source === args.source)
      : items;

    return filtered.slice(0, topK);
  },
});

// ── searchFTS (full-text search via Convex search index) ────────────────
export const searchFTS = query({
  args: {
    deviceToken: v.string(),
    queryText: v.string(),
    source: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const user = await getUserByToken(ctx, args.deviceToken);
    const limit = args.limit ?? 20;

    let searchQuery = ctx.db
      .query("items")
      .withSearchIndex("search_content", (q) => {
        let search = q.search("content", args.queryText);
        search = search.eq("userId", user._id);
        if (args.source) {
          search = search.eq("source", args.source);
        }
        return search;
      });

    const results = await searchQuery.take(limit);
    return results;
  },
});

// ── browse (filter by source, date range, sender, with pagination) ──────
export const browse = query({
  args: {
    deviceToken: v.string(),
    source: v.optional(v.string()),
    startDate: v.optional(v.number()),
    endDate: v.optional(v.number()),
    sender: v.optional(v.string()),
    paginationOpts: v.object({
      numItems: v.number(),
      cursor: v.union(v.string(), v.null()),
    }),
  },
  handler: async (ctx, args) => {
    const user = await getUserByToken(ctx, args.deviceToken);

    // Use the compound index to filter by userId (and optionally source)
    let baseQuery;
    if (args.source) {
      baseQuery = ctx.db
        .query("items")
        .withIndex("by_user_source_externalId", (q) =>
          q.eq("userId", user._id).eq("source", args.source!)
        );
    } else {
      baseQuery = ctx.db
        .query("items")
        .withIndex("by_user_source_externalId", (q) =>
          q.eq("userId", user._id)
        );
    }

    const results = await baseQuery.paginate(args.paginationOpts);

    // Post-filter by date range and sender in JS
    const filtered = results.page.filter((item) => {
      if (args.startDate && item.createdAt < args.startDate) return false;
      if (args.endDate && item.createdAt > args.endDate) return false;
      if (args.sender) {
        const meta = item.metadata as Record<string, unknown>;
        if (meta?.sender !== args.sender) return false;
      }
      return true;
    });

    return {
      page: filtered,
      isDone: results.isDone,
      continueCursor: results.continueCursor,
    };
  },
});

// ── getById (single item, verify ownership) ─────────────────────────────
export const getById = query({
  args: {
    deviceToken: v.string(),
    itemId: v.id("items"),
  },
  handler: async (ctx, args) => {
    const user = await getUserByToken(ctx, args.deviceToken);
    const item = await ctx.db.get(args.itemId);

    if (!item || item.userId !== user._id) {
      throw new Error("Item not found or access denied");
    }

    const { embedding, ...rest } = item;
    return rest;
  },
});

// ── getRecentItems (latest N items, optionally by source) ───────────────
export const getRecentItems = query({
  args: {
    deviceToken: v.string(),
    source: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const user = await getUserByToken(ctx, args.deviceToken);
    const limit = args.limit ?? 20;

    let baseQuery;
    if (args.source) {
      baseQuery = ctx.db
        .query("items")
        .withIndex("by_user_source_externalId", (q) =>
          q.eq("userId", user._id).eq("source", args.source!)
        );
    } else {
      baseQuery = ctx.db
        .query("items")
        .withIndex("by_user_source_externalId", (q) =>
          q.eq("userId", user._id)
        );
    }

    // Convex orders by _creationTime desc with .order("desc")
    const items = await baseQuery.order("desc").take(limit);

    return items.map(({ embedding, ...rest }) => rest);
  },
});

// ── getStats (counts per source with date ranges) ───────────────────────
export const getStats = query({
  args: {
    deviceToken: v.string(),
  },
  handler: async (ctx, args) => {
    const user = await getUserByToken(ctx, args.deviceToken);

    const allItems = await ctx.db
      .query("items")
      .withIndex("by_user_source_externalId", (q) =>
        q.eq("userId", user._id)
      )
      .collect();

    const stats: Record<
      string,
      { count: number; earliest: number; latest: number }
    > = {};

    for (const item of allItems) {
      if (!stats[item.source]) {
        stats[item.source] = {
          count: 0,
          earliest: item.createdAt,
          latest: item.createdAt,
        };
      }
      stats[item.source].count++;
      if (item.createdAt < stats[item.source].earliest) {
        stats[item.source].earliest = item.createdAt;
      }
      if (item.createdAt > stats[item.source].latest) {
        stats[item.source].latest = item.createdAt;
      }
    }

    return stats;
  },
});
