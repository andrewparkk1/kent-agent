/**
 * Tests for daemon/channel-handler.ts.
 *
 * Strategy:
 *   - Mock @shared/config.ts, @shared/db.ts, @shared/channel-state.ts, and
 *     daemon/inprocess-runner.ts to avoid real DB / LLM / filesystem access.
 *   - Use in-memory state to verify full routing behavior.
 *   - Use a fake Channel that captures all outbound calls.
 */
import { test, expect, describe, beforeEach, mock } from "bun:test";

// ─── In-memory state ───────────────────────────────────────────────────────

interface StoredMessage {
  threadId: string;
  role: string;
  content: string;
}
interface StoredThread {
  id: string;
  title: string;
  status?: string;
  meta?: any;
}

const state = {
  threads: [] as StoredThread[],
  messages: [] as StoredMessage[],
  persistentThreads: new Map<string, string>(),
  msgToThread: new Map<string, string>(), // "channel:msgId" → threadId
  runnerCalls: [] as any[],
  runnerResult: { output: "agent response", error: false, throw: false as any },
};

function resetState() {
  state.threads = [];
  state.messages = [];
  state.persistentThreads.clear();
  state.msgToThread.clear();
  state.runnerCalls = [];
  state.runnerResult = { output: "agent response", error: false, throw: false };
}

// ─── Mocks ────────────────────────────────────────────────────────────────

mock.module("@shared/config.ts", () => ({
  loadConfig: () => ({
    core: { device_token: "", timezone: "UTC" },
    keys: { anthropic: "test-key" },
    agent: { default_model: "claude-test", provider: "anthropic", base_url: "", api_key: "" },
    telegram: { bot_token: "", chat_ids: [] },
    daemon: { sync_interval_seconds: 300 },
    sources: {},
  }),
  KENT_DIR: "/tmp/kent-test-channel-handler",
  ensureKentDir: () => {},
}));

mock.module("@shared/db.ts", () => ({
  createThread: async (title: string, meta?: any) => {
    const id = `thread-${state.threads.length + 1}`;
    state.threads.push({ id, title, meta });
    return id;
  },
  addMessage: async (threadId: string, role: string, content: string) => {
    state.messages.push({ threadId, role, content });
  },
  getMessages: async (threadId: string, _limit?: number) => {
    return state.messages
      .filter((m) => m.threadId === threadId)
      .map((m) => ({ role: m.role, content: m.content }));
  },
  finishThread: async (threadId: string, status: string) => {
    const t = state.threads.find((t) => t.id === threadId);
    if (t) t.status = status;
  },
  getThread: async () => null,
  getRecentThreads: () => [],
  getWorkflowRuns: async () => [],
  listMemories: async () => [],
  getItemCount: async () => ({}),
  upsertItems: async () => {},
  searchItems: () => [],
  getItemsBySource: async () => [],
  getLatestItemTimestamp: async () => 0,
  createMemory: async () => ({}),
  updateMemory: async () => ({}),
  archiveMemory: async () => ({}),
  getMemory: async () => null,
  searchMemories: () => [],
  deleteMemory: async () => {},
  linkMemories: async () => {},
  unlinkMemories: async () => {},
  getLinkedMemories: () => [],
  getBacklinks: () => [],
  getAllLinks: async () => ({ outgoing: [], incoming: [] }),
  createWorkflow: async () => ({}),
  listWorkflows: () => [],
  getWorkflow: () => null,
  updateWorkflow: async () => {},
  deleteWorkflow: async () => {},
  archiveWorkflow: async () => {},
  unarchiveWorkflow: async () => {},
  getDueWorkflows: async () => [],
}));

mock.module("@shared/channel-state.ts", () => ({
  getThreadForChannelMessage: async (channel: string, msgId: string) => {
    return state.msgToThread.get(`${channel}:${msgId}`) ?? null;
  },
  mapChannelMessageToThread: async (channel: string, msgId: string, threadId: string) => {
    state.msgToThread.set(`${channel}:${msgId}`, threadId);
  },
  getPersistentThreadId: async (key: string) => state.persistentThreads.get(key) ?? null,
  setPersistentThreadId: async (key: string, threadId: string) => {
    state.persistentThreads.set(key, threadId);
  },
}));

// Mock InProcessRunner so no real agent runs
mock.module("@daemon/inprocess-runner.ts", () => ({
  InProcessRunner: class {
    constructor(_cfg: any) {}
    async run(prompt: string, _wfId: any, cb: any, options: any) {
      state.runnerCalls.push({ prompt, options });
      if (state.runnerResult.throw) {
        throw state.runnerResult.throw;
      }
      // Stream the output via callback as text chunks
      if (cb && state.runnerResult.output) {
        cb(state.runnerResult.output, "text");
      }
      return {
        runId: "run-1",
        output: state.runnerResult.output,
        files: {},
        stderr: "",
        exitCode: state.runnerResult.error ? 1 : 0,
      };
    }
    async kill() {}
  },
}));

// Now import after mocks
const { startChannelPolling } = await import("@daemon/channel-handler.ts");
import type { Channel, ChannelMessage } from "@shared/channels/types.ts";

// ─── Fake Channel ──────────────────────────────────────────────────────────

class FakeChannel implements Channel {
  readonly name = "fakechan";
  typingCalls: string[] = [];
  replies: Array<{ text: string; chatId: string; replyTo: string; returnedId: string }> = [];
  nextReplyId = 1;
  replyShouldThrow: Error | null = null;
  private handler: ((m: ChannelMessage) => Promise<void>) | null = null;

  isConfigured(): boolean {
    return true;
  }

  async sendNotification(_t: string) {
    return [];
  }

  async sendReply(text: string, chatId: string, replyToMessageId: string): Promise<string> {
    if (this.replyShouldThrow) throw this.replyShouldThrow;
    const id = `reply-${this.nextReplyId++}`;
    this.replies.push({ text, chatId, replyTo: replyToMessageId, returnedId: id });
    return id;
  }

  async sendTypingIndicator(chatId: string): Promise<void> {
    this.typingCalls.push(chatId);
  }

  async startPolling(onMessage: (msg: ChannelMessage) => Promise<void>): Promise<void> {
    this.handler = onMessage;
    // Return immediately — tests invoke the handler manually
  }

  // Test helper
  async deliver(msg: ChannelMessage) {
    if (!this.handler) throw new Error("not polling");
    await this.handler(msg);
  }
}

// ─── Tests ─────────────────────────────────────────────────────────────────

describe("startChannelPolling", () => {
  let logs: string[];
  const log = (m: string) => logs.push(m);

  beforeEach(() => {
    resetState();
    logs = [];
  });

  test("logs 'polling started' for the channel", async () => {
    const ch = new FakeChannel();
    await startChannelPolling(ch, log);
    expect(logs.some((l) => l.includes("fakechan") && l.includes("polling started"))).toBe(true);
  });

  test("first message creates a new persistent thread", async () => {
    const ch = new FakeChannel();
    await startChannelPolling(ch, log);

    await ch.deliver({
      id: "msg-1",
      text: "hello",
      from: "alice",
      chatId: "chat-abc",
    });

    expect(state.threads).toHaveLength(1);
    expect(state.persistentThreads.get("fakechan:chat-abc")).toBe("thread-1");
    // The user message should be stored
    expect(state.messages.some((m) => m.role === "user" && m.content === "hello")).toBe(true);
  });

  test("second message in same chat reuses the persistent thread", async () => {
    const ch = new FakeChannel();
    await startChannelPolling(ch, log);

    await ch.deliver({ id: "m1", text: "hi", from: "u", chatId: "c1" });
    await ch.deliver({ id: "m2", text: "again", from: "u", chatId: "c1" });

    expect(state.threads).toHaveLength(1);
    const threadId = state.threads[0]!.id;
    const userMsgs = state.messages.filter((m) => m.role === "user");
    expect(userMsgs).toHaveLength(2);
    expect(userMsgs.every((m) => m.threadId === threadId)).toBe(true);
  });

  test("different chats get different persistent threads", async () => {
    const ch = new FakeChannel();
    await startChannelPolling(ch, log);

    await ch.deliver({ id: "m1", text: "hi", from: "u", chatId: "chat-1" });
    await ch.deliver({ id: "m2", text: "hi", from: "u", chatId: "chat-2" });

    expect(state.threads).toHaveLength(2);
    expect(state.persistentThreads.get("fakechan:chat-1")).not.toBe(
      state.persistentThreads.get("fakechan:chat-2"),
    );
  });

  test("reply to a known message uses that message's thread", async () => {
    const ch = new FakeChannel();
    await startChannelPolling(ch, log);

    // Pre-map a message to an existing thread (e.g. a workflow notification)
    state.threads.push({ id: "workflow-thread", title: "wf" });
    state.msgToThread.set("fakechan:notif-99", "workflow-thread");

    await ch.deliver({
      id: "user-msg",
      text: "reply",
      from: "u",
      chatId: "chat-1",
      replyToMessageId: "notif-99",
    });

    // User message should be attached to the workflow thread
    const userMsg = state.messages.find((m) => m.content === "reply");
    expect(userMsg?.threadId).toBe("workflow-thread");
  });

  test("reply to unknown message falls back to persistent thread", async () => {
    const ch = new FakeChannel();
    await startChannelPolling(ch, log);

    // Set up existing persistent thread
    state.threads.push({ id: "persistent-1", title: "persistent" });
    state.persistentThreads.set("fakechan:chat-1", "persistent-1");

    await ch.deliver({
      id: "new-msg",
      text: "hello",
      from: "u",
      chatId: "chat-1",
      replyToMessageId: "long-gone-msg",
    });

    const userMsg = state.messages.find((m) => m.content === "hello");
    expect(userMsg?.threadId).toBe("persistent-1");
  });

  test("agent is invoked with the prompt and thread context", async () => {
    const ch = new FakeChannel();
    await startChannelPolling(ch, log);

    await ch.deliver({ id: "m1", text: "what time is it?", from: "u", chatId: "c1" });

    expect(state.runnerCalls).toHaveLength(1);
    expect(state.runnerCalls[0].prompt).toBe("what time is it?");
    expect(state.runnerCalls[0].options.threadId).toBeTruthy();
  });

  test("conversation history is built from prior user messages", async () => {
    const ch = new FakeChannel();
    await startChannelPolling(ch, log);

    // First message — stores user msg
    await ch.deliver({ id: "m1", text: "hi", from: "u", chatId: "c1" });
    // Second message — history contains first user message (assistant storage
    // happens inside runAgent which is mocked out here)
    await ch.deliver({ id: "m2", text: "again", from: "u", chatId: "c1" });

    const secondCall = state.runnerCalls[1];
    expect(secondCall.options.conversationHistory).toContain("Human: hi");
  });

  test("conversation history role prefixes work for both user and assistant", async () => {
    // Directly seed an assistant message to verify the prefix mapping.
    const ch = new FakeChannel();
    await startChannelPolling(ch, log);

    // Pre-create thread with persistent mapping + a prior assistant message
    state.threads.push({ id: "pre-thread", title: "pre" });
    state.persistentThreads.set("fakechan:c1", "pre-thread");
    state.messages.push({ threadId: "pre-thread", role: "user", content: "earlier q" });
    state.messages.push({ threadId: "pre-thread", role: "assistant", content: "earlier a" });

    await ch.deliver({ id: "m-new", text: "new q", from: "u", chatId: "c1" });

    const history = state.runnerCalls[0].options.conversationHistory;
    expect(history).toContain("Human: earlier q");
    expect(history).toContain("Assistant: earlier a");
  });

  test("first message has empty conversation history", async () => {
    const ch = new FakeChannel();
    await startChannelPolling(ch, log);
    await ch.deliver({ id: "m1", text: "hello", from: "u", chatId: "c1" });
    expect(state.runnerCalls[0].options.conversationHistory).toBe("");
  });

  test("assistant reply is stored by agent tool (we check finish status)", async () => {
    const ch = new FakeChannel();
    await startChannelPolling(ch, log);

    await ch.deliver({ id: "m1", text: "hi", from: "u", chatId: "c1" });

    // Thread should end with status 'done'
    const thread = state.threads.find((t) => t.id === "thread-1");
    expect(thread?.status).toBe("done");
  });

  test("typing indicator is sent for the correct chat", async () => {
    const ch = new FakeChannel();
    await startChannelPolling(ch, log);

    await ch.deliver({ id: "m1", text: "hi", from: "u", chatId: "chat-xyz" });

    expect(ch.typingCalls).toContain("chat-xyz");
  });

  test("response is sent as reply to the original message", async () => {
    const ch = new FakeChannel();
    await startChannelPolling(ch, log);

    await ch.deliver({ id: "orig-42", text: "hi", from: "u", chatId: "chat-1" });

    expect(ch.replies).toHaveLength(1);
    expect(ch.replies[0]).toMatchObject({
      chatId: "chat-1",
      replyTo: "orig-42",
      text: "agent response",
    });
  });

  test("reply message is mapped back to thread for future replies", async () => {
    const ch = new FakeChannel();
    await startChannelPolling(ch, log);

    await ch.deliver({ id: "m1", text: "hi", from: "u", chatId: "c1" });
    const replyId = ch.replies[0]!.returnedId;

    expect(state.msgToThread.get(`fakechan:${replyId}`)).toBe("thread-1");
  });

  test("agent error sets thread status to error and sends fallback text", async () => {
    state.runnerResult.throw = new Error("agent exploded");
    const ch = new FakeChannel();
    await startChannelPolling(ch, log);

    await ch.deliver({ id: "m1", text: "hi", from: "u", chatId: "c1" });

    const thread = state.threads[0]!;
    expect(thread.status).toBe("error");
    expect(ch.replies[0]!.text).toContain("error");
    expect(logs.some((l) => l.includes("agent error"))).toBe(true);
  });

  test("empty agent output falls back to default text", async () => {
    state.runnerResult.output = "";
    const ch = new FakeChannel();
    await startChannelPolling(ch, log);

    await ch.deliver({ id: "m1", text: "hi", from: "u", chatId: "c1" });

    expect(ch.replies[0]!.text).toContain("no text response");
  });

  test("sendReply failure is logged but does not throw", async () => {
    const ch = new FakeChannel();
    ch.replyShouldThrow = new Error("network down");
    await startChannelPolling(ch, log);

    await ch.deliver({ id: "m1", text: "hi", from: "u", chatId: "c1" });

    expect(logs.some((l) => l.includes("failed to send response"))).toBe(true);
  });

  test("handler errors from handleIncomingMessage are caught by outer try/catch", async () => {
    // Induce error via finishThread — mock loadConfig to throw
    const ch = new FakeChannel();
    await startChannelPolling(ch, log);

    // The outer handler catches any exception thrown during processing and logs.
    // Simulate by mapping a runner that throws synchronously during construction:
    state.runnerResult.throw = new Error("runtime boom");
    await ch.deliver({ id: "m1", text: "msg", from: "u", chatId: "c1" });
    // Should not have thrown — log captures "agent error"
    expect(logs.some((l) => l.includes("agent error"))).toBe(true);
  });

  test("logs receipt of each incoming message", async () => {
    const ch = new FakeChannel();
    await startChannelPolling(ch, log);
    await ch.deliver({ id: "m1", text: "message body", from: "bob", chatId: "c1" });
    expect(logs.some((l) => l.includes("received message from bob"))).toBe(true);
  });
});
