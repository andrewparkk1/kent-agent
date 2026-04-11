/**
 * Tests for channel message routing logic.
 *
 * Uses an in-memory SQLite database to test the full routing flow:
 * - Thread resolution (reply context vs persistent thread)
 * - Message ↔ thread mapping
 * - Per-chat persistent threads
 * - Workflow notification routing
 * - Conversation history building
 */
import { test, expect, describe, beforeEach } from "bun:test";
import { Database } from "bun:sqlite";

// ─── In-memory DB helpers (replicate kv + threads + messages tables) ────────

function createTestDb(): Database {
  const db = new Database(":memory:");
  db.exec("PRAGMA journal_mode = WAL");
  db.exec(`
    CREATE TABLE kv (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE TABLE threads (
      id TEXT PRIMARY KEY,
      title TEXT,
      type TEXT NOT NULL DEFAULT 'chat',
      workflow_id TEXT,
      status TEXT,
      started_at INTEGER,
      finished_at INTEGER,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      last_message_at INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE TABLE messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      thread_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      metadata TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch())
    );
  `);
  return db;
}

// ─── Inline routing functions (same logic as channel-state.ts, using test DB) ─

function mapMessageToThread(db: Database, channel: string, msgId: string, threadId: string) {
  db.run("INSERT OR REPLACE INTO kv (key, value) VALUES (?, ?)", [`ch:${channel}:msg:${msgId}`, threadId]);
  db.run("INSERT OR REPLACE INTO kv (key, value) VALUES (?, ?)", [`ch:${channel}:thread:${threadId}`, msgId]);
}

function getThreadForMessage(db: Database, channel: string, msgId: string): string | null {
  const row = db.prepare("SELECT value FROM kv WHERE key = ?").get(`ch:${channel}:msg:${msgId}`) as { value: string } | null;
  return row?.value ?? null;
}

function getPersistentThread(db: Database, key: string): string | null {
  const row = db.prepare("SELECT value FROM kv WHERE key = ?").get(`ch:${key}:persistent_thread`) as { value: string } | null;
  return row?.value ?? null;
}

function setPersistentThread(db: Database, key: string, threadId: string) {
  db.run("INSERT OR REPLACE INTO kv (key, value) VALUES (?, ?)", [`ch:${key}:persistent_thread`, threadId]);
}

function createThread(db: Database, title: string, type: string): string {
  const id = crypto.randomUUID();
  db.run("INSERT INTO threads (id, title, type) VALUES (?, ?, ?)", [id, title, type]);
  return id;
}

function addMessage(db: Database, threadId: string, role: string, content: string) {
  db.run("INSERT INTO messages (thread_id, role, content) VALUES (?, ?, ?)", [threadId, role, content]);
}

function getMessages(db: Database, threadId: string): { role: string; content: string }[] {
  return db.prepare("SELECT role, content FROM messages WHERE thread_id = ? ORDER BY created_at ASC").all(threadId) as any[];
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("Message → thread mapping", () => {
  let db: Database;

  beforeEach(() => { db = createTestDb(); });

  test("maps a message to a thread and retrieves it", () => {
    mapMessageToThread(db, "telegram", "msg-1", "thread-abc");
    expect(getThreadForMessage(db, "telegram", "msg-1")).toBe("thread-abc");
  });

  test("returns null for unknown message", () => {
    expect(getThreadForMessage(db, "telegram", "msg-unknown")).toBeNull();
  });

  test("different channels have separate namespaces", () => {
    mapMessageToThread(db, "telegram", "msg-1", "thread-tg");
    mapMessageToThread(db, "slack", "msg-1", "thread-slack");
    expect(getThreadForMessage(db, "telegram", "msg-1")).toBe("thread-tg");
    expect(getThreadForMessage(db, "slack", "msg-1")).toBe("thread-slack");
  });

  test("overwrites mapping for same message ID", () => {
    mapMessageToThread(db, "telegram", "msg-1", "thread-old");
    mapMessageToThread(db, "telegram", "msg-1", "thread-new");
    expect(getThreadForMessage(db, "telegram", "msg-1")).toBe("thread-new");
  });
});

describe("Persistent thread per chat", () => {
  let db: Database;

  beforeEach(() => { db = createTestDb(); });

  test("creates and retrieves persistent thread", () => {
    setPersistentThread(db, "telegram:chat-123", "thread-abc");
    expect(getPersistentThread(db, "telegram:chat-123")).toBe("thread-abc");
  });

  test("returns null when no persistent thread set", () => {
    expect(getPersistentThread(db, "telegram:chat-999")).toBeNull();
  });

  test("different chats get different persistent threads", () => {
    setPersistentThread(db, "telegram:chat-1", "thread-1");
    setPersistentThread(db, "telegram:chat-2", "thread-2");
    expect(getPersistentThread(db, "telegram:chat-1")).toBe("thread-1");
    expect(getPersistentThread(db, "telegram:chat-2")).toBe("thread-2");
  });

  test("different channels with same chat ID get different threads", () => {
    setPersistentThread(db, "telegram:chat-1", "thread-tg");
    setPersistentThread(db, "slack:chat-1", "thread-slack");
    expect(getPersistentThread(db, "telegram:chat-1")).toBe("thread-tg");
    expect(getPersistentThread(db, "slack:chat-1")).toBe("thread-slack");
  });
});

describe("Thread resolution logic (simulates channel-handler)", () => {
  let db: Database;

  beforeEach(() => { db = createTestDb(); });

  /**
   * Simulates handleIncomingMessage thread resolution:
   * 1. If replying → find that message's thread
   * 2. Else → find persistent thread for this chat
   * 3. Else → create new thread
   */
  function resolveThread(channel: string, chatId: string, replyToMessageId?: string): string {
    // Step 1: reply context
    if (replyToMessageId) {
      const threadId = getThreadForMessage(db, channel, replyToMessageId);
      if (threadId) return threadId;
    }

    // Step 2: persistent thread
    const persistentKey = `${channel}:${chatId}`;
    const persistentId = getPersistentThread(db, persistentKey);
    if (persistentId) return persistentId;

    // Step 3: create new
    const newId = createThread(db, `${channel} chat`, "chat");
    setPersistentThread(db, persistentKey, newId);
    return newId;
  }

  test("first message in a chat creates a new persistent thread", () => {
    const threadId = resolveThread("telegram", "chat-1");
    expect(threadId).toBeTruthy();
    // Subsequent messages use the same thread
    const threadId2 = resolveThread("telegram", "chat-1");
    expect(threadId2).toBe(threadId);
  });

  test("different chats get different threads", () => {
    const thread1 = resolveThread("telegram", "chat-1");
    const thread2 = resolveThread("telegram", "chat-2");
    expect(thread1).not.toBe(thread2);
  });

  test("replying to a workflow notification routes to that workflow thread", () => {
    // Simulate: workflow creates thread, sends notification, gets message ID
    const workflowThreadId = createThread(db, "workflow: morning-briefing", "workflow");
    mapMessageToThread(db, "telegram", "notification-msg-42", workflowThreadId);

    // User replies to notification message
    const resolved = resolveThread("telegram", "chat-1", "notification-msg-42");
    expect(resolved).toBe(workflowThreadId);
  });

  test("replying to Kent's chat response stays in the same thread", () => {
    // First message creates persistent thread
    const threadId = resolveThread("telegram", "chat-1");

    // Kent responds, map the response message to the thread
    mapMessageToThread(db, "telegram", "kent-reply-99", threadId);

    // User replies to Kent's response
    const resolved = resolveThread("telegram", "chat-1", "kent-reply-99");
    expect(resolved).toBe(threadId);
  });

  test("reply to unknown message falls back to persistent thread", () => {
    const threadId = resolveThread("telegram", "chat-1");
    // Reply to a message that was never mapped (e.g. old message before Kent was set up)
    const resolved = resolveThread("telegram", "chat-1", "unknown-msg-999");
    expect(resolved).toBe(threadId);
  });

  test("reply to workflow notification doesn't affect persistent thread", () => {
    // Set up persistent thread
    const persistentThread = resolveThread("telegram", "chat-1");

    // Workflow notification mapped to different thread
    const workflowThread = createThread(db, "workflow: test", "workflow");
    mapMessageToThread(db, "telegram", "notif-50", workflowThread);

    // Reply to notification → goes to workflow thread
    expect(resolveThread("telegram", "chat-1", "notif-50")).toBe(workflowThread);

    // Normal message → still goes to persistent thread
    expect(resolveThread("telegram", "chat-1")).toBe(persistentThread);
  });
});

describe("Conversation history building", () => {
  let db: Database;

  beforeEach(() => { db = createTestDb(); });

  test("builds history from prior messages in thread", () => {
    const threadId = createThread(db, "test chat", "chat");
    addMessage(db, threadId, "user", "Hello Kent");
    addMessage(db, threadId, "assistant", "Hi! How can I help?");
    addMessage(db, threadId, "user", "What's on my calendar?");

    const messages = getMessages(db, threadId);
    const priorMessages = messages
      .filter((m) => m.role === "user" || m.role === "assistant")
      .slice(0, -1); // Exclude current message

    const history = priorMessages
      .map((m) => `${m.role === "user" ? "Human" : "Assistant"}: ${m.content}`)
      .join("\n\n");

    expect(history).toBe("Human: Hello Kent\n\nAssistant: Hi! How can I help?");
  });

  test("first message has empty history", () => {
    const threadId = createThread(db, "test chat", "chat");
    addMessage(db, threadId, "user", "First message ever");

    const messages = getMessages(db, threadId);
    const priorMessages = messages
      .filter((m) => m.role === "user" || m.role === "assistant")
      .slice(0, -1);

    expect(priorMessages).toHaveLength(0);
  });

  test("tool messages are excluded from conversation history", () => {
    const threadId = createThread(db, "test chat", "chat");
    addMessage(db, threadId, "user", "Check my email");
    addMessage(db, threadId, "tool", '{"event":"tool_start","name":"search_items"}');
    addMessage(db, threadId, "assistant", "You have 3 new emails");
    addMessage(db, threadId, "user", "Tell me more about the first one");

    const messages = getMessages(db, threadId);
    const priorMessages = messages
      .filter((m) => m.role === "user" || m.role === "assistant")
      .slice(0, -1);

    expect(priorMessages).toHaveLength(2);
    expect(priorMessages[0]!.content).toBe("Check my email");
    expect(priorMessages[1]!.content).toBe("You have 3 new emails");
  });
});

describe("Notification flow", () => {
  let db: Database;

  beforeEach(() => { db = createTestDb(); });

  test("workflow notification maps message to thread for reply routing", () => {
    const workflowThread = createThread(db, "workflow: morning-briefing", "workflow");

    // Simulate notifyAllChannels: sends message, maps it
    const sentMsgId = "telegram-msg-42";
    mapMessageToThread(db, "telegram", sentMsgId, workflowThread);

    // Later, user replies to that notification
    const resolvedThread = getThreadForMessage(db, "telegram", sentMsgId);
    expect(resolvedThread).toBe(workflowThread);
  });

  test("notifications to multiple chats all map to same thread", () => {
    const workflowThread = createThread(db, "workflow: test", "workflow");

    // Notification sent to two chats → two different Telegram messages
    mapMessageToThread(db, "telegram", "msg-chat1-100", workflowThread);
    mapMessageToThread(db, "telegram", "msg-chat2-200", workflowThread);

    // Replies from either chat route to the same workflow thread
    expect(getThreadForMessage(db, "telegram", "msg-chat1-100")).toBe(workflowThread);
    expect(getThreadForMessage(db, "telegram", "msg-chat2-200")).toBe(workflowThread);
  });
});
