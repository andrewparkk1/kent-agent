import { test, expect, describe } from "bun:test";
import {
  getChannel,
  listChannelNames,
  registerChannel,
} from "@cli/channels/channel.ts";

describe("Channel registry", () => {
  test("telegram is registered by default", () => {
    const names = listChannelNames();
    expect(names).toContain("telegram");
  });

  test("listChannelNames returns an array", () => {
    const names = listChannelNames();
    expect(Array.isArray(names)).toBe(true);
  });

  test("getChannel throws for unknown channel", async () => {
    expect(getChannel("nonexistent-channel")).rejects.toThrow(
      /Unknown channel/,
    );
  });

  test("getChannel throws with helpful message listing available channels", async () => {
    try {
      await getChannel("foobar");
      expect(true).toBe(false); // Should not reach here
    } catch (e: any) {
      expect(e.message).toContain("foobar");
      expect(e.message).toContain("telegram");
    }
  });

  test("registerChannel adds a new channel", () => {
    const before = listChannelNames();
    registerChannel("test-channel", async () => ({
      name: "test-channel",
      start: async () => {},
      stop: async () => {},
      notify: async () => {},
    }));
    const after = listChannelNames();
    expect(after.length).toBe(before.length + 1);
    expect(after).toContain("test-channel");
  });

  test("registered channel can be retrieved", async () => {
    registerChannel("mock-channel", async () => ({
      name: "mock-channel",
      start: async () => {},
      stop: async () => {},
      notify: async () => {},
    }));
    const channel = await getChannel("mock-channel");
    expect(channel.name).toBe("mock-channel");
    expect(typeof channel.start).toBe("function");
    expect(typeof channel.stop).toBe("function");
    expect(typeof channel.notify).toBe("function");
  });
});
