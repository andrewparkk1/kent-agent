import { test, expect, describe, beforeEach } from "bun:test";
import { mkdtempSync, writeFileSync, mkdirSync, utimesSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { MockSyncState, validateItem, LIVE } from "./_helpers.ts";
import { createAiCodingSource, aiCoding } from "@daemon/sources/ai-coding.ts";

const FIXED_NOW_SEC = 1_700_000_000;

function isoAt(sec: number): string {
  return new Date(sec * 1000).toISOString();
}

function setMtime(path: string, sec: number) {
  const d = new Date(sec * 1000);
  utimesSync(path, d, d);
}

interface Fixture {
  claudeDir: string;
  codexDir: string;
}

function makeFixture(): Fixture {
  const root = mkdtempSync(join(tmpdir(), "ai-coding-"));

  // Claude Code: ~/.claude/projects/<slug>/<session>.jsonl
  const claudeDir = join(root, ".claude", "projects");
  const projectSlug = "-Users-me-repos-kent-agent";
  const projectPath = join(claudeDir, projectSlug);
  mkdirSync(projectPath, { recursive: true });

  const claudeSessionPath = join(projectPath, "session-1.jsonl");
  const claudeLines = [
    JSON.stringify({
      type: "user",
      uuid: "uuid-user-1",
      timestamp: isoAt(FIXED_NOW_SEC - 1000),
      sessionId: "sess-1",
      cwd: "/Users/me/repos/kent-agent",
      gitBranch: "main",
      message: { content: "How do I refactor this function?" },
    }),
    JSON.stringify({
      type: "assistant",
      uuid: "uuid-assist-1",
      timestamp: isoAt(FIXED_NOW_SEC - 990),
      sessionId: "sess-1",
      message: {
        content: [
          { type: "text", text: "Here is how you refactor the function step by step." },
        ],
      },
    }),
    // Too short — should be filtered
    JSON.stringify({
      type: "user",
      uuid: "uuid-user-2",
      timestamp: isoAt(FIXED_NOW_SEC - 500),
      sessionId: "sess-1",
      message: { content: "ok" },
    }),
  ];
  writeFileSync(claudeSessionPath, claudeLines.join("\n") + "\n");
  setMtime(claudeSessionPath, FIXED_NOW_SEC - 400);

  // Codex: ~/.codex/history.jsonl + archived_sessions/*.jsonl
  const codexDir = join(root, ".codex");
  mkdirSync(codexDir, { recursive: true });
  const historyPath = join(codexDir, "history.jsonl");
  const historyLines = [
    JSON.stringify({
      session_id: "codex-sess-1",
      ts: FIXED_NOW_SEC - 800,
      text: "Generate a REST endpoint for users",
    }),
    // Too short
    JSON.stringify({ session_id: "codex-sess-1", ts: FIXED_NOW_SEC - 700, text: "hi" }),
  ];
  writeFileSync(historyPath, historyLines.join("\n") + "\n");
  setMtime(historyPath, FIXED_NOW_SEC - 400);

  const archivesDir = join(codexDir, "archived_sessions");
  mkdirSync(archivesDir, { recursive: true });
  const archivePath = join(archivesDir, "session-a.jsonl");
  const archiveLines = [
    JSON.stringify({
      type: "session_meta",
      payload: {
        id: "codex-sess-1",
        cwd: "/Users/me/repos/kent-agent",
        model_provider: "openai",
        source: "cli",
      },
    }),
    JSON.stringify({
      type: "response_item",
      timestamp: isoAt(FIXED_NOW_SEC - 600),
      payload: {
        role: "assistant",
        type: "message",
        content: [
          { type: "output_text", text: "Sure, here's the REST endpoint code for you." },
        ],
      },
    }),
  ];
  writeFileSync(archivePath, archiveLines.join("\n") + "\n");
  setMtime(archivePath, FIXED_NOW_SEC - 400);

  return { claudeDir, codexDir };
}

describe("ai-coding source (fixture)", () => {
  let fx: Fixture;
  beforeEach(() => {
    fx = makeFixture();
  });

  test("existing export still works", () => {
    expect(aiCoding.name).toBe("ai_coding");
    expect(typeof aiCoding.fetchNew).toBe("function");
  });

  test("reads Claude Code + Codex history + Codex sessions", async () => {
    const src = createAiCodingSource({
      claudeDir: fx.claudeDir,
      codexDir: fx.codexDir,
      now: () => FIXED_NOW_SEC,
    });
    const items = await src.fetchNew(new MockSyncState());

    for (const item of items) {
      validateItem(item, "ai_coding", /^(claude:|codex:)/);
    }

    // Claude Code: 1 user prompt (valid length) + 1 assistant response = 2
    const claudeItems = items.filter((i) => i.externalId.startsWith("claude:"));
    expect(claudeItems.length).toBe(2);

    const claudeUser = claudeItems.find((i) => i.externalId === "claude:uuid-user-1")!;
    expect(claudeUser).toBeDefined();
    expect(claudeUser.content).toContain("[Claude Code Query]");
    expect(claudeUser.content).toContain("refactor this function");
    expect(claudeUser.metadata.tool).toBe("claude_code");
    expect(claudeUser.metadata.type).toBe("prompt");
    expect(claudeUser.metadata.sessionId).toBe("sess-1");
    expect(claudeUser.metadata.cwd).toBe("/Users/me/repos/kent-agent");
    expect(claudeUser.metadata.branch).toBe("main");

    const claudeAssist = claudeItems.find((i) => i.externalId === "claude:uuid-assist-1")!;
    expect(claudeAssist).toBeDefined();
    expect(claudeAssist.content).toContain("[Claude Code Response]");
    expect(claudeAssist.content).toContain("refactor the function");
    expect(claudeAssist.metadata.type).toBe("response");

    // Codex history prompt
    const codexHistory = items.find((i) => i.externalId === `codex:codex-sess-1:${FIXED_NOW_SEC - 800}`)!;
    expect(codexHistory).toBeDefined();
    expect(codexHistory.content).toContain("[Codex Query]");
    expect(codexHistory.content).toContain("REST endpoint for users");
    expect(codexHistory.metadata.tool).toBe("codex");
    expect(codexHistory.metadata.type).toBe("prompt");
    expect(codexHistory.metadata.sessionId).toBe("codex-sess-1");

    // Codex archived session response
    const codexResp = items.find((i) => i.externalId.startsWith("codex:resp:"))!;
    expect(codexResp).toBeDefined();
    expect(codexResp.content).toContain("[Codex Response]");
    expect(codexResp.content).toContain("REST endpoint code");
    expect(codexResp.metadata.type).toBe("response");
    expect(codexResp.metadata.sessionId).toBe("codex-sess-1");
    expect(codexResp.metadata.cwd).toBe("/Users/me/repos/kent-agent");
    expect(codexResp.metadata.model).toBe("openai");
    expect(codexResp.metadata.entrypoint).toBe("cli");
  });

  test("too-short messages are filtered", async () => {
    const src = createAiCodingSource({ claudeDir: fx.claudeDir, codexDir: fx.codexDir });
    const items = await src.fetchNew(new MockSyncState());
    for (const it of items) {
      expect(it.externalId).not.toBe("claude:uuid-user-2");
    }
    // The "hi" codex short prompt must not appear either
    for (const it of items) {
      if (it.externalId.startsWith("codex:codex-sess-1:")) {
        expect(it.content).not.toContain(" hi");
      }
    }
  });

  test("sync cutoff: entries before lastSync are excluded", async () => {
    const src = createAiCodingSource({ claudeDir: fx.claudeDir, codexDir: fx.codexDir });
    const state = new MockSyncState();
    state.markSynced("ai_coding", FIXED_NOW_SEC + 10);
    const items = await src.fetchNew(state);
    expect(items.length).toBe(0);
  });

  test("missing dirs return empty without throwing", async () => {
    const src = createAiCodingSource({
      claudeDir: join(tmpdir(), "nope-claude-" + Math.random()),
      codexDir: join(tmpdir(), "nope-codex-" + Math.random()),
    });
    const items = await src.fetchNew(new MockSyncState());
    expect(items).toEqual([]);
  });

  test.skipIf(!LIVE)("LIVE: reads from real Claude/Codex session logs", async () => {
    const items = await aiCoding.fetchNew(new MockSyncState(), { defaultDays: 7, limit: 10 });
    for (const item of items) validateItem(item, "ai_coding", /^(claude|codex):/);
  }, 60_000);
});
