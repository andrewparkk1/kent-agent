import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  users: defineTable({
    deviceToken: v.string(),
    createdAt: v.number(),
    encryptedKeys: v.optional(v.string()),
    encryptionSalt: v.optional(v.string()), // base64-encoded salt for key decryption
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
    })
    .vectorIndex("by_embedding", {
      vectorField: "embedding",
      dimensions: 1536,
      filterFields: ["userId", "source"],
    }),

  workflows: defineTable({
    userId: v.id("users"),
    name: v.string(),
    prompt: v.string(),
    runner: v.optional(v.string()),
    cronSchedule: v.optional(v.string()),
    triggerSource: v.optional(v.string()),
    enabled: v.boolean(),
  }).index("by_userId", ["userId"]),

  threads: defineTable({
    userId: v.id("users"),
    title: v.optional(v.string()),
    channel: v.string(), // "cli", "telegram", "api"
    channelId: v.optional(v.string()), // e.g. telegram chat ID
    createdAt: v.number(),
    lastMessageAt: v.number(),
  })
    .index("by_userId_and_lastMessageAt", ["userId", "lastMessageAt"])
    .index("by_userId_and_channel_and_channelId", ["userId", "channel", "channelId"]),

  runs: defineTable({
    userId: v.id("users"),
    workflowId: v.optional(v.id("workflows")),
    prompt: v.string(),
    status: v.string(),
    output: v.optional(v.string()),
    startedAt: v.number(),
    finishedAt: v.optional(v.number()),
  }).index("by_userId", ["userId"]),

  agentPrompts: defineTable({
    userId: v.id("users"),
    name: v.string(), // e.g. "IDENTITY.md", "skills/github.md"
    content: v.string(),
    updatedAt: v.number(),
  })
    .index("by_userId_and_name", ["userId", "name"])
    .index("by_userId", ["userId"]),

  messages: defineTable({
    threadId: v.optional(v.id("threads")),
    runId: v.optional(v.id("runs")),
    role: v.string(),
    content: v.string(),
    toolName: v.optional(v.string()),
    toolArgs: v.optional(v.any()),
    createdAt: v.number(),
  })
    .index("by_thread_and_createdAt", ["threadId", "createdAt"])
    .index("by_run_and_createdAt", ["runId", "createdAt"]),
});
