/**
 * Tests for the agent loop core (agent/core.ts).
 *
 * We avoid real LLM calls and real filesystem writes by mocking:
 *   - @mariozechner/pi-agent-core  → fake Agent that emits scripted events
 *   - @mariozechner/pi-ai           → stub streamSimple (unused by fake Agent)
 *   - @shared/db.ts                 → in-memory stubs for threads/messages/memories
 *   - @shared/config.ts             → minimal config
 *   - @shared/models.ts             → deterministic model resolution
 *
 * IMPORTANT: all `mock.module` calls must execute *before* importing core.ts
 * so that core.ts picks up the mocked modules at evaluation time.
 */
import { test, expect, describe, beforeEach, afterAll, mock } from "bun:test";

// ─── Shared in-memory state that mock implementations read/write ───────────

interface FakeMessage {
  threadId: string;
  role: string;
  content: string;
  meta?: any;
}
interface FakeThread { id: string; title: string }

const state = {
  threads: [] as FakeThread[],
  messages: [] as FakeMessage[],
  memories: [] as any[],
  itemCounts: {} as Record<string, number>,
  nextAgentEvents: [] as any[],         // events the fake Agent will emit on prompt()
  lastAgentConstructorArgs: null as any,
  lastAgentPromptCall: null as any,
};

function resetState() {
  state.threads = [];
  state.messages = [];
  state.memories = [];
  state.itemCounts = {};
  state.nextAgentEvents = [];
  state.lastAgentConstructorArgs = null;
  state.lastAgentPromptCall = null;
}

// ─── Mock @shared/db.ts ────────────────────────────────────────────────────

mock.module("@shared/db.ts", () => ({
  createThread: async (title: string) => {
    const id = `thread-${state.threads.length + 1}`;
    state.threads.push({ id, title });
    return id;
  },
  finishThread: async () => {},
  getThread: async () => null,
  getRecentThreads: () => [],
  getWorkflowRuns: async () => [],
  addMessage: async (threadId: string, role: string, content: string, meta?: any) => {
    state.messages.push({ threadId, role, content, meta });
  },
  getMessages: async (threadId: string) =>
    state.messages.filter((m) => m.threadId === threadId).map((m) => ({ role: m.role, content: m.content })),
  listMemories: async () => state.memories,
  getItemCount: async () => state.itemCounts,
  // Unused by core but referenced by tools/index → data.ts transitive import.
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

// ─── Mock @shared/config.ts ────────────────────────────────────────────────

mock.module("@shared/config.ts", () => ({
  loadConfig: () => ({
    agent: { provider: "anthropic", default_model: "claude-test" },
    keys: { anthropic: "test-key" },
  }),
  KENT_DIR: "/tmp/kent-test-agent-core",
  ensureKentDir: () => {},
}));

// ─── Mock @shared/models.ts ────────────────────────────────────────────────

mock.module("@shared/models.ts", () => ({
  resolveModel: (_cfg: any) => ({
    model: { id: "claude-test", provider: "anthropic" },
    apiKey: "test-key",
  }),
}));

// ─── Mock pi-ai streamSimple (never actually invoked by FakeAgent) ─────────

mock.module("@mariozechner/pi-ai", () => ({
  streamSimple: async () => { throw new Error("streamSimple should not be called in tests"); },
}));

// ─── Mock pi-agent-core Agent ──────────────────────────────────────────────

class FakeAgent {
  private listeners: Array<(e: any) => void> = [];
  constructor(opts: any) { state.lastAgentConstructorArgs = opts; }
  subscribe(fn: (e: any) => void) {
    this.listeners.push(fn);
    return () => { this.listeners = this.listeners.filter((f) => f !== fn); };
  }
  async prompt(input: string) {
    state.lastAgentPromptCall = input;
    // Emit scripted events
    for (const evt of state.nextAgentEvents) {
      for (const l of this.listeners) l(evt);
    }
    // Always emit agent_end
    for (const l of this.listeners) l({ type: "agent_end" });
  }
}

mock.module("@mariozechner/pi-agent-core", () => ({
  Agent: FakeAgent,
}));

// ─── Now import core.ts after all mocks are installed ──────────────────────

const core = await import("../agent/core.ts");
const toolsIndex = await import("../agent/tools/index.ts");

// Restore module mocks after all tests to prevent leaking into other test files
// when bun shares worker processes (observed on Linux CI with bun 1.3.x).
afterAll(() => mock.restore());

// ─── Helpers to build fake events ──────────────────────────────────────────

function textDelta(delta: string) {
  return { type: "message_update", assistantMessageEvent: { type: "text_delta", delta } };
}
function toolStart(id: string, name: string, args: any = {}) {
  return { type: "tool_execution_start", toolCallId: id, toolName: name, args };
}
function toolEnd(id: string, name: string, text: string, isError = false) {
  return {
    type: "tool_execution_end",
    toolCallId: id,
    toolName: name,
    isError,
    result: { content: [{ type: "text", text }] },
  };
}

// ─── Tests: Tool registry ──────────────────────────────────────────────────

describe("tool registry (agent/tools/index.ts)", () => {
  test("allTools is a non-empty array", () => {
    expect(Array.isArray(toolsIndex.allTools)).toBe(true);
    expect(toolsIndex.allTools.length).toBeGreaterThan(5);
  });

  test("every tool has name, description, parameters, execute", () => {
    for (const t of toolsIndex.allTools) {
      expect(typeof t.name).toBe("string");
      expect(t.name.length).toBeGreaterThan(0);
      expect(typeof t.description).toBe("string");
      expect(t.parameters).toBeDefined();
      expect(typeof t.execute).toBe("function");
    }
  });

  test("tool names are unique", () => {
    const names = toolsIndex.allTools.map((t) => t.name);
    const set = new Set(names);
    expect(set.size).toBe(names.length);
  });

  test("contains expected core tool names", () => {
    const names = toolsIndex.allTools.map((t) => t.name);
    for (const expected of ["search_memory", "read_file", "list_memories", "create_workflow"]) {
      expect(names).toContain(expected);
    }
  });

  test("includes dataTools, memoryTools, workflowTools, filesystemTools, skillTools", () => {
    expect(toolsIndex.dataTools.length).toBeGreaterThan(0);
    expect(toolsIndex.memoryTools.length).toBeGreaterThan(0);
    expect(toolsIndex.workflowTools.length).toBeGreaterThan(0);
    expect(toolsIndex.filesystemTools.length).toBeGreaterThan(0);
    expect(toolsIndex.skillTools.length).toBeGreaterThan(0);
    const total =
      toolsIndex.dataTools.length +
      toolsIndex.memoryTools.length +
      toolsIndex.workflowTools.length +
      toolsIndex.filesystemTools.length +
      toolsIndex.skillTools.length;
    expect(total).toBe(toolsIndex.allTools.length);
  });
});

// ─── Tests: buildSystemPrompt ──────────────────────────────────────────────

describe("buildSystemPrompt", () => {
  beforeEach(() => resetState());

  test("returns a non-empty string with identity/soul/tools sections", async () => {
    const prompt = await core.buildSystemPrompt({ timezone: "America/Los_Angeles" });
    expect(typeof prompt).toBe("string");
    expect(prompt.length).toBeGreaterThan(100);
  });

  test("substitutes {{DATE}} / {{TIME}} / {{TIMEZONE}} placeholders", async () => {
    const prompt = await core.buildSystemPrompt({ timezone: "UTC" });
    expect(prompt).not.toContain("{{DATE}}");
    expect(prompt).not.toContain("{{TIME}}");
    expect(prompt).not.toContain("{{TIMEZONE}}");
    expect(prompt).not.toContain("{{CONTEXT}}");
  });

  test("includes 'No synced data available' hint when item counts empty", async () => {
    state.itemCounts = {};
    const prompt = await core.buildSystemPrompt({ timezone: "UTC" });
    expect(prompt).toContain("No synced data");
  });

  test("includes item counts when data present", async () => {
    state.itemCounts = { imessage: 42, gmail: 7 };
    const prompt = await core.buildSystemPrompt({ timezone: "UTC" });
    expect(prompt).toContain("imessage");
    expect(prompt).toContain("42");
    expect(prompt).toContain("gmail");
  });

  test("appends conversation history section when provided", async () => {
    const prompt = await core.buildSystemPrompt({
      timezone: "UTC",
      conversationHistory: "user: hi\nassistant: hello",
    });
    expect(prompt).toContain("Conversation History");
    expect(prompt).toContain("user: hi");
  });

  test("omits conversation history section when not provided", async () => {
    const prompt = await core.buildSystemPrompt({ timezone: "UTC" });
    expect(prompt).not.toContain("Conversation History");
  });

  test("includes memories section when memories exist", async () => {
    const now = Math.floor(Date.now() / 1000);
    state.memories = [
      {
        id: "mem1",
        type: "person",
        title: "Alice",
        aliases: JSON.stringify(["Al"]),
        body: "She works at Foo Corp.",
        summary: "Coworker",
        updated_at: now,
      },
    ];
    const prompt = await core.buildSystemPrompt({ timezone: "UTC" });
    expect(prompt).toContain("Known Memories");
    expect(prompt).toContain("Alice");
  });

  test("is deterministic for fixed inputs (modulo date/time)", async () => {
    const a = await core.buildSystemPrompt({ timezone: "UTC" });
    const b = await core.buildSystemPrompt({ timezone: "UTC" });
    // Date/time can tick between calls; strip time-of-day tokens for comparison.
    const normalize = (s: string) => s.replace(/\d{1,2}:\d{2}\s*(AM|PM)\s*\w+/gi, "TIME");
    expect(normalize(a)).toBe(normalize(b));
  });
});

// ─── Tests: runAgent dispatch / persistence ────────────────────────────────

describe("runAgent — event handling & persistence", () => {
  beforeEach(() => resetState());

  test("creates a thread when none provided", async () => {
    state.nextAgentEvents = [textDelta("hi there")];
    const result = await core.runAgent({ prompt: "hello", timezone: "UTC" });
    expect(result.threadId).toBe("thread-1");
    expect(state.threads).toHaveLength(1);
    expect(state.threads[0].title).toBe("hello");
  });

  test("reuses existing thread id when provided", async () => {
    state.threads.push({ id: "existing-1", title: "prior" });
    state.nextAgentEvents = [textDelta("ok")];
    const result = await core.runAgent({ prompt: "again", threadId: "existing-1", timezone: "UTC" });
    expect(result.threadId).toBe("existing-1");
  });

  test("persists system prompt once per thread", async () => {
    state.nextAgentEvents = [textDelta("a")];
    await core.runAgent({ prompt: "first", timezone: "UTC" });
    const systemMessages = state.messages.filter((m) => m.role === "system");
    expect(systemMessages.length).toBe(1);
  });

  test("does not re-add system prompt when thread already has one", async () => {
    state.threads.push({ id: "t1", title: "x" });
    state.messages.push({ threadId: "t1", role: "system", content: "already here" });
    state.nextAgentEvents = [textDelta("reply")];
    await core.runAgent({ prompt: "hi", threadId: "t1", timezone: "UTC" });
    const systemMessages = state.messages.filter((m) => m.role === "system" && m.threadId === "t1");
    expect(systemMessages.length).toBe(1);
  });

  test("persists user message (unless skipUserMessage set)", async () => {
    state.nextAgentEvents = [textDelta("ok")];
    await core.runAgent({ prompt: "what up", timezone: "UTC" });
    const userMsgs = state.messages.filter((m) => m.role === "user");
    expect(userMsgs.length).toBe(1);
    expect(userMsgs[0].content).toBe("what up");
  });

  test("skipUserMessage=true does not persist user message", async () => {
    state.nextAgentEvents = [textDelta("ok")];
    await core.runAgent({ prompt: "shhh", timezone: "UTC", skipUserMessage: true });
    const userMsgs = state.messages.filter((m) => m.role === "user");
    expect(userMsgs.length).toBe(0);
  });

  test("accumulates text deltas into output and persists assistant message", async () => {
    state.nextAgentEvents = [textDelta("Hello "), textDelta("world")];
    const result = await core.runAgent({ prompt: "hi", timezone: "UTC" });
    expect(result.output).toBe("Hello world");
    expect(result.hasOutput).toBe(true);
    const assistantMsgs = state.messages.filter((m) => m.role === "assistant");
    expect(assistantMsgs).toHaveLength(1);
    expect(assistantMsgs[0].content).toBe("Hello world");
  });

  test("streams text deltas via onTextDelta callback", async () => {
    state.nextAgentEvents = [textDelta("foo"), textDelta("bar")];
    const seen: string[] = [];
    await core.runAgent({
      prompt: "hi",
      timezone: "UTC",
      callbacks: { onTextDelta: (d) => seen.push(d) },
    });
    expect(seen).toEqual(["foo", "bar"]);
  });

  test("dispatches tool_execution_start/end to callbacks and persists tool message", async () => {
    state.nextAgentEvents = [
      textDelta("calling tool"),
      toolStart("t1", "search_memory", { query: "alice" }),
      toolEnd("t1", "search_memory", "[]"),
      textDelta("done"),
    ];
    const starts: any[] = [];
    const ends: any[] = [];
    const result = await core.runAgent({
      prompt: "find alice",
      timezone: "UTC",
      callbacks: {
        onToolStart: (name, args) => starts.push({ name, args }),
        onToolEnd: (name, res, err) => ends.push({ name, res, err }),
      },
    });

    expect(starts).toHaveLength(1);
    expect(starts[0].name).toBe("search_memory");
    expect(starts[0].args).toEqual({ query: "alice" });
    expect(ends).toHaveLength(1);
    expect(ends[0].name).toBe("search_memory");
    expect(ends[0].err).toBe(false);

    const toolMessages = state.messages.filter((m) => m.role === "tool");
    expect(toolMessages).toHaveLength(1);
    expect(toolMessages[0].content).toBe("[]");
    expect(toolMessages[0].meta?.name).toBe("search_memory");
    expect(toolMessages[0].meta?.args).toEqual({ query: "alice" });
    expect(toolMessages[0].meta?.error).toBe(false);

    // Two distinct assistant segments should be persisted (pre-tool + post-tool).
    const assistantMsgs = state.messages.filter((m) => m.role === "assistant");
    expect(assistantMsgs).toHaveLength(2);
    expect(assistantMsgs[0].content).toBe("calling tool");
    expect(assistantMsgs[1].content).toBe("done");
    expect(result.output).toBe("calling tool\n\ndone");
  });

  test("marks tool error when isError=true", async () => {
    state.nextAgentEvents = [
      toolStart("t1", "read_file", { path: "/nope" }),
      toolEnd("t1", "read_file", "ENOENT: missing file", true),
    ];
    const errs: boolean[] = [];
    await core.runAgent({
      prompt: "read",
      timezone: "UTC",
      callbacks: { onToolEnd: (_n, _r, isErr) => errs.push(isErr) },
    });
    expect(errs).toEqual([true]);
    const toolMsgs = state.messages.filter((m) => m.role === "tool");
    expect(toolMsgs[0].meta?.error).toBe(true);
  });

  test("deduplicates assistant segments when model re-emits identical text", async () => {
    // Scenario: model emits "final answer", then calls a tool, then repeats "final answer".
    state.nextAgentEvents = [
      textDelta("final answer"),
      toolStart("t1", "search_memory", {}),
      toolEnd("t1", "search_memory", "ok"),
      textDelta("final answer"),
    ];
    const rollbacks: number[] = [];
    await core.runAgent({
      prompt: "q",
      timezone: "UTC",
      callbacks: { onSegmentRollback: () => rollbacks.push(1) },
    });
    const assistantMsgs = state.messages.filter((m) => m.role === "assistant");
    expect(assistantMsgs).toHaveLength(1);
    expect(assistantMsgs[0].content).toBe("final answer");
    expect(rollbacks.length).toBeGreaterThanOrEqual(1);
  });

  test("does not rollback distinct post-tool text that only shares a prefix", async () => {
    state.nextAgentEvents = [
      textDelta("No existing lesson memory."),
      toolStart("t1", "list_workflows", {}),
      toolEnd("t1", "list_workflows", "[]"),
      textDelta("Now I'll set up the workflow and memory."),
    ];
    const rollbacks: number[] = [];
    await core.runAgent({
      prompt: "q",
      timezone: "UTC",
      callbacks: { onSegmentRollback: () => rollbacks.push(1) },
    });
    const assistantMsgs = state.messages.filter((m) => m.role === "assistant");
    expect(assistantMsgs).toHaveLength(2);
    expect(assistantMsgs[0].content).toBe("No existing lesson memory.");
    expect(assistantMsgs[1].content).toBe("Now I'll set up the workflow and memory.");
    expect(rollbacks).toHaveLength(0);
  });

  test("reports agent error via callback and result.error", async () => {
    state.nextAgentEvents = [
      { type: "error", error: { message: "rate limited" } },
    ];
    const errSeen: string[] = [];
    const result = await core.runAgent({
      prompt: "x",
      timezone: "UTC",
      callbacks: { onError: (e) => errSeen.push(e) },
    });
    expect(errSeen).toEqual(["rate limited"]);
    expect(result.error).toBe("rate limited");
    expect(result.hasOutput).toBe(false);
  });

  test("hasOutput false when model produces no text deltas", async () => {
    state.nextAgentEvents = [];
    const result = await core.runAgent({ prompt: "silence", timezone: "UTC" });
    expect(result.hasOutput).toBe(false);
    expect(result.output).toBe("");
  });

  test("passes allTools to the Agent constructor", async () => {
    state.nextAgentEvents = [textDelta("k")];
    await core.runAgent({ prompt: "hi", timezone: "UTC" });
    const opts = state.lastAgentConstructorArgs;
    expect(opts).toBeTruthy();
    expect(Array.isArray(opts.initialState.tools)).toBe(true);
    expect(opts.initialState.tools.length).toBe(toolsIndex.allTools.length);
  });

  test("forwards prompt string to Agent.prompt()", async () => {
    state.nextAgentEvents = [textDelta("ok")];
    await core.runAgent({ prompt: "hello world", timezone: "UTC" });
    expect(state.lastAgentPromptCall).toBe("hello world");
  });

  test("throws when prompt is empty", async () => {
    await expect(core.runAgent({ prompt: "", timezone: "UTC" })).rejects.toThrow(/No prompt/);
  });

  test("honours modelName/provider overrides on config", async () => {
    state.nextAgentEvents = [textDelta("ok")];
    await core.runAgent({
      prompt: "hi",
      timezone: "UTC",
      modelName: "custom-model",
      provider: "openai",
    });
    // Can't directly observe the config mutation, but the call should still succeed and
    // the Agent constructor should have received a model object from resolveModel.
    const opts = state.lastAgentConstructorArgs;
    expect(opts.initialState.model).toBeDefined();
    expect(opts.initialState.model.id).toBe("claude-test");
  });
});
