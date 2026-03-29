import { test, expect, describe } from "bun:test";

/**
 * Tests for the channel registry system.
 */

describe("Channel registry", () => {
  test("listChannelNames includes telegram", async () => {
    const { listChannelNames } = await import("../cli/channels/channel.ts");
    const names = listChannelNames();

    expect(names).toContain("telegram");
    expect(names.length).toBeGreaterThanOrEqual(1);
  });

  test("getChannel throws for unknown channel", async () => {
    const { getChannel } = await import("../cli/channels/channel.ts");

    expect(getChannel("nonexistent")).rejects.toThrow("Unknown channel");
  });

  test("getChannel returns Channel for telegram", async () => {
    const { getChannel } = await import("../cli/channels/channel.ts");

    // This will try to instantiate TelegramChannel which may fail
    // without a valid bot token, but it should not throw "Unknown channel"
    try {
      const channel = await getChannel("telegram");
      expect(channel.name).toBe("telegram");
    } catch (e: any) {
      // If it fails, it should be about config/token, not "Unknown channel"
      expect(e.message).not.toContain("Unknown channel");
    }
  });

  test("registerChannel adds new channel", async () => {
    const { registerChannel, getChannel, listChannelNames } = await import("../cli/channels/channel.ts");

    const mockChannel = {
      name: "test-channel",
      start: async () => {},
      stop: async () => {},
      notify: async () => {},
    };

    registerChannel("test-channel", async () => mockChannel);

    expect(listChannelNames()).toContain("test-channel");

    const channel = await getChannel("test-channel");
    expect(channel.name).toBe("test-channel");
  });
});

describe("Channel interface compliance", () => {
  test("Channel interface has required methods", async () => {
    const { registerChannel, getChannel } = await import("../cli/channels/channel.ts");

    const mockChannel = {
      name: "mock",
      start: async () => {},
      stop: async () => {},
      notify: async (msg: string) => {},
    };

    registerChannel("mock-test", async () => mockChannel);
    const channel = await getChannel("mock-test");

    expect(typeof channel.start).toBe("function");
    expect(typeof channel.stop).toBe("function");
    expect(typeof channel.notify).toBe("function");
    expect(typeof channel.name).toBe("string");
  });
});
