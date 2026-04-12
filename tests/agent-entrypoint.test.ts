/**
 * Tests for the agent CLI entry point (agent/agent.ts).
 *
 * agent.ts is a thin subprocess wrapper around runAgent() that reads config
 * from environment variables and streams events to stdout/stderr. We test
 * the wiring we can observe without invoking a real LLM:
 *   - missing PROMPT → exits 1 with an error on stderr
 *
 * The happy-path of agent.ts (a real LLM turn) is covered by runAgent() tests
 * in agent-core.test.ts, which mocks the LLM. Spawning agent.ts with full
 * mocks is not feasible from a subprocess, so we document that limitation here.
 */
import { test, expect, describe } from "bun:test";

const AGENT_PATH = new URL("../agent/agent.ts", import.meta.url).pathname;

async function runAgentScript(env: Record<string, string>): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const proc = Bun.spawn(["bun", "run", AGENT_PATH], {
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, ...env },
  });
  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  const exitCode = await proc.exited;
  return { stdout, stderr, exitCode };
}

describe("agent.ts entry point", () => {
  test("exits 1 with an error when PROMPT is missing", async () => {
    const { stderr, exitCode } = await runAgentScript({ PROMPT: "", HOME: "/tmp/kent-test-agent-entrypoint" });
    expect(exitCode).toBe(1);
    expect(stderr).toContain("No PROMPT provided");
  });

  test("exits 1 when PROMPT is unset (empty default)", async () => {
    // Clear PROMPT explicitly. Bun.spawn env overrides, but node env inheritance
    // may leak a PROMPT from the harness — force empty string.
    const { exitCode, stderr } = await runAgentScript({ PROMPT: "", HOME: "/tmp/kent-test-agent-entrypoint" });
    expect(exitCode).toBe(1);
    expect(stderr.length).toBeGreaterThan(0);
  });
});
