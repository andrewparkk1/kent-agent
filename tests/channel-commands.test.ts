import { test, expect, describe, beforeEach } from "bun:test";
import { join } from "node:path";

const CLI_PATH = join(import.meta.dir, "..", "cli", "index.ts");

/**
 * Helper to run the CLI as a subprocess and capture output + exit code.
 */
async function runCLI(
  ...args: string[]
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const proc = Bun.spawn(["bun", "run", CLI_PATH, ...args], {
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, NO_COLOR: "1" },
  });

  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  const exitCode = await proc.exited;

  return { stdout, stderr, exitCode };
}

// ── CLI Subprocess Tests ────────────────────────────────────────────────────

describe("CLI channel command routing", () => {
  test("kent channel with no subcommand shows usage and exits 1", async () => {
    const { stdout, exitCode } = await runCLI("channel");

    expect(exitCode).toBe(1);
    expect(stdout).toContain("Usage:");
    expect(stdout).toContain("kent channel start <name>");
    expect(stdout).toContain("kent channel stop <name>");
    expect(stdout).toContain("kent channel status");
    expect(stdout).toContain("Available channels:");
  });

  test("kent channel invalid shows usage and exits 1", async () => {
    const { stdout, exitCode } = await runCLI("channel", "invalid");

    expect(exitCode).toBe(1);
    expect(stdout).toContain("Usage:");
    expect(stdout).toContain("kent channel start <name>");
  });

  test("kent channel start without channel name shows error and exits 1", async () => {
    const { stderr, exitCode } = await runCLI("channel", "start");

    expect(exitCode).toBe(1);
    expect(stderr).toContain("Usage: kent channel start <name>");
    expect(stderr).toContain("Available channels:");
  });

  test("kent channel stop without channel name shows error and exits 1", async () => {
    const { stderr, exitCode } = await runCLI("channel", "stop");

    expect(exitCode).toBe(1);
    expect(stderr).toContain("Usage: kent channel stop <name>");
  });

  test("kent channel status runs without crashing", async () => {
    const { exitCode } = await runCLI("channel", "status");

    // status should exit 0 regardless of whether channels are running
    expect(exitCode).toBe(0);
  });

  test("kent channel start with unknown channel name exits with error", async () => {
    const { stderr, exitCode } = await runCLI(
      "channel",
      "start",
      "nonexistent-channel-xyz",
    );

    // getChannel throws for unknown channels, which causes exit 1
    expect(exitCode).toBe(1);
    expect(stderr).toContain("nonexistent-channel-xyz");
  });
});

// ── Channel Registry Unit Tests ─────────────────────────────────────────────

describe("Channel interface and registry", () => {
  test("mock channel implements all required methods", async () => {
    const { registerChannel, getChannel } = await import(
      "../cli/channels/channel.ts"
    );

    const mockChannel = {
      name: "full-mock",
      start: async () => {},
      stop: async () => {},
      notify: async (_message: string, _runId?: string) => {},
    };

    registerChannel("full-mock", async () => mockChannel);
    const channel = await getChannel("full-mock");

    expect(channel.name).toBe("full-mock");
    expect(typeof channel.start).toBe("function");
    expect(typeof channel.stop).toBe("function");
    expect(typeof channel.notify).toBe("function");
  });

  test("channel notify can be called with just message (runId optional)", async () => {
    const { registerChannel, getChannel } = await import(
      "../cli/channels/channel.ts"
    );

    const notifyCalls: { message: string; runId?: string }[] = [];
    const mockChannel = {
      name: "notify-test",
      start: async () => {},
      stop: async () => {},
      notify: async (message: string, runId?: string) => {
        notifyCalls.push({ message, runId });
      },
    };

    registerChannel("notify-test", async () => mockChannel);
    const channel = await getChannel("notify-test");

    // Call with message only
    await channel.notify("hello");
    expect(notifyCalls).toHaveLength(1);
    expect(notifyCalls[0].message).toBe("hello");
    expect(notifyCalls[0].runId).toBeUndefined();

    // Call with message and runId
    await channel.notify("world", "run-123");
    expect(notifyCalls).toHaveLength(2);
    expect(notifyCalls[1].message).toBe("world");
    expect(notifyCalls[1].runId).toBe("run-123");
  });

  test("registerChannel overwrites existing channel factory", async () => {
    const { registerChannel, getChannel } = await import(
      "../cli/channels/channel.ts"
    );

    const firstChannel = {
      name: "overwrite-v1",
      start: async () => {},
      stop: async () => {},
      notify: async () => {},
    };

    const secondChannel = {
      name: "overwrite-v2",
      start: async () => {},
      stop: async () => {},
      notify: async () => {},
    };

    registerChannel("overwrite-test", async () => firstChannel);
    const first = await getChannel("overwrite-test");
    expect(first.name).toBe("overwrite-v1");

    // Overwrite with a new factory
    registerChannel("overwrite-test", async () => secondChannel);
    const second = await getChannel("overwrite-test");
    expect(second.name).toBe("overwrite-v2");
  });

  test("listChannelNames returns consistent list including built-in channels", async () => {
    const { listChannelNames } = await import("../cli/channels/channel.ts");

    const names = listChannelNames();

    // Should always include the built-in telegram channel
    expect(names).toContain("telegram");
    // Should be an array of strings
    expect(Array.isArray(names)).toBe(true);
    for (const name of names) {
      expect(typeof name).toBe("string");
      expect(name.length).toBeGreaterThan(0);
    }
  });

  test("getChannel error message includes available channels", async () => {
    const { getChannel, listChannelNames } = await import(
      "../cli/channels/channel.ts"
    );

    const availableNames = listChannelNames();

    try {
      await getChannel("does-not-exist-abc");
      // Should not reach here
      expect(true).toBe(false);
    } catch (err: any) {
      expect(err.message).toContain('Unknown channel: "does-not-exist-abc"');
      expect(err.message).toContain("Available channels:");
      // The error message should mention at least one registered channel
      for (const name of availableNames) {
        expect(err.message).toContain(name);
      }
    }
  });

  test("multiple channels can be registered simultaneously", async () => {
    const { registerChannel, getChannel, listChannelNames } = await import(
      "../cli/channels/channel.ts"
    );

    const channelNames = ["multi-a", "multi-b", "multi-c"];

    for (const name of channelNames) {
      registerChannel(name, async () => ({
        name,
        start: async () => {},
        stop: async () => {},
        notify: async () => {},
      }));
    }

    const registeredNames = listChannelNames();
    for (const name of channelNames) {
      expect(registeredNames).toContain(name);
    }

    // Each channel can be retrieved independently
    for (const name of channelNames) {
      const channel = await getChannel(name);
      expect(channel.name).toBe(name);
    }
  });
});
