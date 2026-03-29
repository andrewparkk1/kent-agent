import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  users: defineTable({
    deviceToken: v.string(),
    createdAt: v.number(),
    encryptedKeys: v.optional(v.string()),
    telegramUserId: v.optional(v.number()),
    telegramUsername: v.optional(v.string()),
  }).index("by_deviceToken", ["deviceToken"]),

  items: defineTable({
    userId: v.id("users"),
    source: v.string(),
    externalId: v.string(),
    content: v.string(),
    metadata: v.any(),
    embedding: v.optional(v.array(v.number())),
    createdAt: v.number(),
    indexedAt: v.optional(v.number()),
  })
    .index("by_user_source_externalId", ["userId", "source", "externalId"])
    .searchIndex("search_content", {
      searchField: "content",
      filterFields: ["userId", "source"],
    }),

  workflows: defineTable({
    userId: v.id("users"),
    name: v.string(),
    prompt: v.string(),
    runner: v.optional(v.string()),
    cronSchedule: v.optional(v.string()),
    triggerSource: v.optional(v.string()),
    outputTarget: v.string(),
    enabled: v.boolean(),
  }).index("by_userId", ["userId"]),

  runs: defineTable({
    userId: v.id("users"),
    workflowId: v.optional(v.id("workflows")),
    prompt: v.string(),
    status: v.string(),
    startedAt: v.number(),
    finishedAt: v.optional(v.number()),
  }).index("by_userId", ["userId"]),

  messages: defineTable({
    runId: v.id("runs"),
    role: v.string(),
    content: v.string(),
    toolName: v.optional(v.string()),
    toolArgs: v.optional(v.any()),
    createdAt: v.number(),
  }).index("by_run_createdAt", ["runId", "createdAt"]),
});
