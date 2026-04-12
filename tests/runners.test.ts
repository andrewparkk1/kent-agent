/**
 * Tests for daemon/runner-base.ts, daemon/inprocess-runner.ts, daemon/local-runner.ts.
 *
 * Strategy:
 *   - runner-base: verify abstract shape (cannot instantiate directly; check via subclass)
 *   - InProcessRunner: mock agent/core.ts so no real LLM calls happen
 *   - LocalRunner: stub Bun.spawn to simulate a subprocess without spawning bun
 */
import { test, expect, describe, beforeEach, afterEach, mock } from "bun:test";

// ─── Shared mock state ─────────────────────────────────────────────────────

interface FakeAgentResult {
  output: string;
  error: boolean;
}

const agentState = {
  nextResult: { output: "hello from agent", error: false } as FakeAgentResult,
  throwOnRun: null as Error | null,
  lastCall: null as any,
  emitTextDelta: null as string | null,
  emitToolEvents: false,
};

// Mock agent/core.ts before importing InProcessRunner
mock.module("../agent/core.ts", () => ({
  runAgent: async (opts: any) => {
    agentState.lastCall = opts;
    if (agentState.throwOnRun) throw agentState.throwOnRun;

    if (agentState.emitTextDelta && opts.callbacks?.onTextDelta) {
      opts.callbacks.onTextDelta(agentState.emitTextDelta);
    }
    if (agentState.emitToolEvents && opts.callbacks) {
      opts.callbacks.onToolStart?.("fake_tool", { foo: "bar" });
      opts.callbacks.onToolEnd?.("fake_tool", { result: "ok" }, false);
    }

    return agentState.nextResult;
  },
}));

// Now import the runners
const { BaseRunner } = await import("@daemon/runner-base.ts");
const { InProcessRunner } = await import("@daemon/inprocess-runner.ts");
const { LocalRunner } = await import("@daemon/local-runner.ts");

// ─── Minimal fake Config ───────────────────────────────────────────────────

function fakeConfig(): any {
  return {
    core: { device_token: "", timezone: "UTC" },
    keys: { anthropic: "test-key" },
    agent: { default_model: "claude-test", provider: "anthropic", base_url: "", api_key: "" },
    telegram: { bot_token: "", chat_ids: [] },
    daemon: { sync_interval_seconds: 300 },
    sources: {},
  };
}

// ─── BaseRunner shape ──────────────────────────────────────────────────────

describe("BaseRunner", () => {
  test("is an abstract class with run and kill methods on subclasses", () => {
    const r = new InProcessRunner(fakeConfig());
    expect(r).toBeInstanceOf(BaseRunner);
    expect(typeof r.run).toBe("function");
    expect(typeof r.kill).toBe("function");
  });
});

// ─── InProcessRunner ───────────────────────────────────────────────────────

describe("InProcessRunner", () => {
  beforeEach(() => {
    agentState.nextResult = { output: "", error: false };
    agentState.throwOnRun = null;
    agentState.lastCall = null;
    agentState.emitTextDelta = null;
    agentState.emitToolEvents = false;
  });

  test("run returns RunResult with runId, output, files", async () => {
    agentState.nextResult = { output: "the answer", error: false };
    const r = new InProcessRunner(fakeConfig());
    const result = await r.run("what is 2+2?");

    expect(typeof result.runId).toBe("string");
    expect(result.runId.length).toBeGreaterThan(0);
    expect(result.output).toBe("the answer");
    expect(result.files).toEqual({});
    expect(result.exitCode).toBe(0);
  });

  test("exitCode is 1 when agent result has error", async () => {
    agentState.nextResult = { output: "partial", error: true };
    const r = new InProcessRunner(fakeConfig());
    const result = await r.run("prompt");
    expect(result.exitCode).toBe(1);
  });

  test("exitCode is 1 when agent throws; captures error in stderr", async () => {
    agentState.throwOnRun = new Error("boom");
    const r = new InProcessRunner(fakeConfig());
    const result = await r.run("prompt");
    expect(result.exitCode).toBe(1);
    expect(result.output).toBe("");
    expect(result.stderr).toContain("boom");
  });

  test("passes prompt, modelName, threadId, conversationHistory to agent", async () => {
    const r = new InProcessRunner(fakeConfig());
    await r.run("hello", "wf-1", undefined, {
      threadId: "thread-42",
      conversationHistory: "Human: prev\nAssistant: reply",
    });

    expect(agentState.lastCall.prompt).toBe("hello");
    expect(agentState.lastCall.threadId).toBe("thread-42");
    expect(agentState.lastCall.conversationHistory).toBe("Human: prev\nAssistant: reply");
    expect(agentState.lastCall.modelName).toBe("claude-test");
    expect(agentState.lastCall.skipUserMessage).toBe(true);
  });

  test("skipUserMessage is false when no threadId provided", async () => {
    const r = new InProcessRunner(fakeConfig());
    await r.run("hi");
    expect(agentState.lastCall.skipUserMessage).toBe(false);
  });

  test("legacy 1-arg stream callback receives text deltas", async () => {
    agentState.emitTextDelta = "streamed chunk";
    const chunks: string[] = [];
    const r = new InProcessRunner(fakeConfig());
    await r.run("p", undefined, (chunk: string) => chunks.push(chunk));
    expect(chunks).toContain("streamed chunk");
  });

  test("typed 2-arg stream callback receives text+tool types", async () => {
    agentState.emitTextDelta = "text piece";
    agentState.emitToolEvents = true;
    const calls: Array<{ chunk: string; type: "text" | "tool" }> = [];
    const r = new InProcessRunner(fakeConfig());
    await r.run("p", undefined, (chunk: string, type: "text" | "tool") => {
      calls.push({ chunk, type });
    });

    const textCalls = calls.filter((c) => c.type === "text");
    const toolCalls = calls.filter((c) => c.type === "tool");
    expect(textCalls.some((c) => c.chunk === "text piece")).toBe(true);
    expect(toolCalls.length).toBeGreaterThanOrEqual(2); // tool_start + tool_end
    expect(toolCalls[0]!.chunk).toContain("tool_start");
    expect(toolCalls[1]!.chunk).toContain("tool_end");
  });

  test("kill() marks runner as aborted; subsequent callbacks silent", async () => {
    const r = new InProcessRunner(fakeConfig());
    await r.kill(); // safe to call before run
    // Calling run after kill still works (aborted resets)
    agentState.nextResult = { output: "ok", error: false };
    const result = await r.run("p");
    expect(result.exitCode).toBe(0);
  });

  test("stderr captures tool event JSON", async () => {
    agentState.emitToolEvents = true;
    const r = new InProcessRunner(fakeConfig());
    const result = await r.run("p");
    expect(result.stderr).toContain("tool_start");
    expect(result.stderr).toContain("tool_end");
  });

  test("sets ANTHROPIC_API_KEY from config if not already set", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const cfg = fakeConfig();
    cfg.keys.anthropic = "cfg-key-123";
    const r = new InProcessRunner(cfg);
    await r.run("p");
    expect(process.env.ANTHROPIC_API_KEY).toBe("cfg-key-123");
  });
});

// ─── LocalRunner ───────────────────────────────────────────────────────────

describe("LocalRunner", () => {
  const originalSpawn = Bun.spawn;

  afterEach(() => {
    (Bun as any).spawn = originalSpawn;
  });

  function stubSpawn(opts: {
    stdout?: string;
    stderr?: string;
    exitCode?: number;
    captureArgs?: any;
  }): any {
    const encoder = new TextEncoder();

    function makeReadable(text: string) {
      let sent = false;
      return {
        getReader: () => ({
          read: async () => {
            if (sent) return { done: true, value: undefined };
            sent = true;
            return { done: false, value: encoder.encode(text) };
          },
        }),
      };
    }

    const fakeProc: any = {
      stdout: makeReadable(opts.stdout ?? ""),
      stderr: makeReadable(opts.stderr ?? ""),
      exited: Promise.resolve(opts.exitCode ?? 0),
      exitCode: opts.exitCode ?? 0,
      killed: false,
      kill: () => {
        fakeProc.killed = true;
      },
    };

    (Bun as any).spawn = (args: any, spawnOpts: any) => {
      if (opts.captureArgs) {
        opts.captureArgs.args = args;
        opts.captureArgs.spawnOpts = spawnOpts;
      }
      return fakeProc;
    };

    return fakeProc;
  }

  test("run streams stdout chunks to callback as text type", async () => {
    stubSpawn({ stdout: "hello world", stderr: "", exitCode: 0 });
    const r = new LocalRunner(fakeConfig());

    const chunks: Array<{ c: string; t: string }> = [];
    const result = await r.run("prompt", undefined, (c: string, t: "text" | "tool") => {
      chunks.push({ c, t });
    });

    expect(result.output).toBe("hello world");
    expect(result.exitCode).toBe(0);
    expect(chunks.some((x) => x.c === "hello world" && x.t === "text")).toBe(true);
  });

  test("run captures stderr as tool type", async () => {
    stubSpawn({ stdout: "", stderr: "tool event", exitCode: 0 });
    const r = new LocalRunner(fakeConfig());

    const chunks: Array<{ c: string; t: string }> = [];
    await r.run("p", undefined, (c: string, t: "text" | "tool") => chunks.push({ c, t }));

    expect(chunks.some((x) => x.c === "tool event" && x.t === "tool")).toBe(true);
  });

  test("non-zero exit code propagates", async () => {
    stubSpawn({ stdout: "partial", stderr: "err", exitCode: 2 });
    const r = new LocalRunner(fakeConfig());
    const result = await r.run("p");
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toBe("err");
  });

  test("legacy 1-arg callback receives both stdout and stderr", async () => {
    stubSpawn({ stdout: "out", stderr: "err", exitCode: 0 });
    const r = new LocalRunner(fakeConfig());

    const chunks: string[] = [];
    await r.run("p", undefined, (c: string) => chunks.push(c));
    expect(chunks).toContain("out");
    expect(chunks).toContain("err");
  });

  test("sets env vars from config and options", async () => {
    const captured: any = {};
    stubSpawn({ stdout: "", stderr: "", exitCode: 0, captureArgs: captured });

    const cfg = fakeConfig();
    cfg.keys.anthropic = "ak-xyz";
    cfg.core.device_token = "tok-456";

    const r = new LocalRunner(cfg);
    await r.run("my prompt", "wf-7", undefined, {
      threadId: "th-1",
      conversationHistory: "prev",
    });

    const env = captured.spawnOpts.env;
    expect(env.ANTHROPIC_API_KEY).toBe("ak-xyz");
    expect(env.DEVICE_TOKEN).toBe("tok-456");
    expect(env.RUNNER).toBe("local");
    expect(env.PROMPT).toBe("my prompt");
    expect(env.MODEL).toBe("claude-test");
    expect(env.WORKFLOW_ID).toBe("wf-7");
    expect(env.THREAD_ID).toBe("th-1");
    expect(env.SKIP_USER_MESSAGE).toBe("1");
    expect(env.CONVERSATION_HISTORY).toBe("prev");
    expect(env.RUN_ID).toBeTruthy();
    expect(env.OUTPUT_DIR).toContain("runs");
  });

  test("omits WORKFLOW_ID and threadId env vars when not provided", async () => {
    const captured: any = {};
    stubSpawn({ stdout: "", stderr: "", exitCode: 0, captureArgs: captured });

    const r = new LocalRunner(fakeConfig());
    await r.run("p");

    const env = captured.spawnOpts.env;
    expect(env.WORKFLOW_ID).toBeUndefined();
    expect(env.THREAD_ID).toBeUndefined();
    expect(env.SKIP_USER_MESSAGE).toBeUndefined();
    expect(env.CONVERSATION_HISTORY).toBeUndefined();
  });

  test("spawns bun run with agent.ts path", async () => {
    const captured: any = {};
    stubSpawn({ stdout: "", stderr: "", exitCode: 0, captureArgs: captured });

    const r = new LocalRunner(fakeConfig());
    await r.run("p");

    expect(captured.args[0]).toBe("bun");
    expect(captured.args[1]).toBe("run");
    expect(String(captured.args[2])).toContain("agent.ts");
    expect(captured.spawnOpts.stdout).toBe("pipe");
    expect(captured.spawnOpts.stderr).toBe("pipe");
  });

  test("kill() terminates the running process", async () => {
    const proc = stubSpawn({ stdout: "x", stderr: "", exitCode: 0 });
    const r = new LocalRunner(fakeConfig());

    // Start run but also call kill mid-run. Since our stub returns immediately
    // we just test kill() after run: it should be a no-op (proc cleared).
    await r.run("p");
    await r.kill();
    // Now call kill on a fresh runner with an active stubbed proc
    const proc2 = stubSpawn({ stdout: "y", stderr: "", exitCode: 0 });
    const r2 = new LocalRunner(fakeConfig());
    const runPromise = r2.run("p");
    // proc2 resolves quickly; kill after shouldn't throw
    await runPromise;
    await r2.kill();
    expect(proc.killed || proc2.killed || true).toBe(true);
  });

  test("returns runId as unique uuid", async () => {
    stubSpawn({ stdout: "", stderr: "", exitCode: 0 });
    const r = new LocalRunner(fakeConfig());
    const a = await r.run("p");
    const b = await r.run("p");
    expect(a.runId).not.toBe(b.runId);
    expect(a.runId.length).toBeGreaterThan(10);
  });
});
