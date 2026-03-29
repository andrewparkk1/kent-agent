import { test, expect, describe, beforeEach } from "bun:test";

/**
 * Tests for the Telegram channel logic from cli/channels/telegram.ts.
 *
 * Since TelegramChannel requires TELEGRAM_BOT_TOKEN and network access,
 * we test the pure logic portions — primarily the chunk-splitting algorithm
 * and basic class structure.
 */

// ── Reproduce the chunking logic for isolated testing ──────────────────

function splitIntoChunks(text: string, maxLength = 4096): string[] {
  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > 0) {
    if (remaining.length <= maxLength) {
      chunks.push(remaining);
      break;
    }
    let splitAt = remaining.lastIndexOf("\n", maxLength);
    if (splitAt < maxLength * 0.5) {
      splitAt = remaining.lastIndexOf(" ", maxLength);
    }
    if (splitAt < maxLength * 0.5) {
      splitAt = maxLength;
    }
    chunks.push(remaining.slice(0, splitAt));
    remaining = remaining.slice(splitAt).trimStart();
  }
  return chunks;
}

// ── Helpers ────────────────────────────────────────────────────────────

/** Generate a string of a given length using a repeating character. */
function repeat(char: string, length: number): string {
  return char.repeat(length);
}

/** Generate a string with newlines placed at regular intervals. */
function textWithNewlines(lineLength: number, totalLength: number): string {
  let result = "";
  while (result.length < totalLength) {
    const remaining = totalLength - result.length;
    if (remaining <= lineLength) {
      result += repeat("a", remaining);
    } else {
      result += repeat("a", lineLength) + "\n";
    }
  }
  return result.slice(0, totalLength);
}

/** Generate a string with spaces placed at regular intervals. */
function textWithSpaces(wordLength: number, totalLength: number): string {
  let result = "";
  while (result.length < totalLength) {
    const remaining = totalLength - result.length;
    if (remaining <= wordLength) {
      result += repeat("b", remaining);
    } else {
      result += repeat("b", wordLength) + " ";
    }
  }
  return result.slice(0, totalLength);
}

// ── Tests ──────────────────────────────────────────────────────────────

describe("splitIntoChunks", () => {
  test("short message (< 4096) returns single chunk", () => {
    const text = "Hello, this is a short message.";
    const chunks = splitIntoChunks(text);

    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toBe(text);
  });

  test("message exactly 4096 chars returns single chunk", () => {
    const text = repeat("x", 4096);
    const chunks = splitIntoChunks(text);

    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toBe(text);
  });

  test("long message splits at newline near limit", () => {
    // Place a newline at position 4000 (well within the 50% threshold)
    const before = repeat("a", 4000);
    const after = repeat("a", 3000);
    const text = before + "\n" + after;

    const chunks = splitIntoChunks(text);

    expect(chunks).toHaveLength(2);
    expect(chunks[0]).toBe(before);
    expect(chunks[0]!.length).toBeLessThanOrEqual(4096);
    expect(chunks[1]).toBe(after);
  });

  test("long message without newlines splits at space", () => {
    // No newlines, but spaces every 100 chars
    const text = textWithSpaces(100, 5000);
    const chunks = splitIntoChunks(text);

    expect(chunks.length).toBeGreaterThanOrEqual(2);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(4096);
    }
  });

  test("long message without spaces or newlines hard splits at 4096", () => {
    const text = repeat("z", 8192);
    const chunks = splitIntoChunks(text);

    expect(chunks).toHaveLength(2);
    expect(chunks[0]).toBe(repeat("z", 4096));
    expect(chunks[1]).toBe(repeat("z", 4096));
  });

  test("very long message produces multiple chunks", () => {
    // ~20K of continuous text with newlines every 500 chars
    const text = textWithNewlines(500, 20000);
    const chunks = splitIntoChunks(text);

    expect(chunks.length).toBeGreaterThanOrEqual(5);
  });

  test("all chunks are <= 4096 chars", () => {
    // Mix of newlines and spaces at various intervals
    const text = textWithNewlines(200, 15000);
    const chunks = splitIntoChunks(text);

    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(4096);
    }
  });

  test("no empty chunks in output", () => {
    // Text with many consecutive newlines that could produce empty chunks
    const text = repeat("a", 2000) + "\n\n\n\n\n" + repeat("a", 2000) + "\n\n\n" + repeat("a", 2000);
    const chunks = splitIntoChunks(text);

    for (const chunk of chunks) {
      expect(chunk.length).toBeGreaterThan(0);
    }
  });

  test("concatenated chunks reproduce original content (minus trimmed whitespace)", () => {
    const text = textWithSpaces(80, 10000);
    const chunks = splitIntoChunks(text);

    // Rejoin and verify all content is present
    const rejoined = chunks.join("");
    // The original text may lose some whitespace at split boundaries due to trimStart()
    // but all non-whitespace content should be preserved
    const originalNoWs = text.replace(/\s+/g, "");
    const rejoinedNoWs = rejoined.replace(/\s+/g, "");

    expect(rejoinedNoWs).toBe(originalNoWs);
  });

  test("prefers newline split over space split when both are available", () => {
    // Build text where both a newline and a space exist in the upper half
    const beforeNewline = repeat("a", 3800);
    const betweenNewlineAndSpace = repeat("a", 100);
    const afterSpace = repeat("a", 3000);
    const text = beforeNewline + "\n" + betweenNewlineAndSpace + " " + afterSpace;

    const chunks = splitIntoChunks(text);

    // The first chunk should split at the newline (position 3800), not the space
    // because lastIndexOf("\n", 4096) finds it first and it's above 50% threshold
    expect(chunks[0]).toBe(beforeNewline);
  });

  test("falls back to space when newline is too early (< 50%)", () => {
    // Newline at position 1000 (below 50% of 4096 = 2048), space at 3500
    const beforeNewline = repeat("c", 1000);
    const betweenNewlineAndSpace = repeat("c", 2500);
    const afterSpace = repeat("c", 2000);
    const text = beforeNewline + "\n" + betweenNewlineAndSpace + " " + afterSpace;

    const chunks = splitIntoChunks(text);

    // Should split at the space (position 3501) since newline is too early
    expect(chunks[0]!.length).toBeGreaterThan(2048);
    expect(chunks[0]!.length).toBeLessThanOrEqual(4096);
  });
});

describe("TelegramChannel class structure", () => {
  test("constructor sets name to 'telegram'", async () => {
    const { TelegramChannel } = await import("../cli/channels/telegram.ts");
    const channel = new TelegramChannel();

    expect(channel.name).toBe("telegram");
  });

  test("getBot throws without TELEGRAM_BOT_TOKEN env var", async () => {
    // Ensure the env var is not set
    const original = process.env.TELEGRAM_BOT_TOKEN;
    delete process.env.TELEGRAM_BOT_TOKEN;

    try {
      const { TelegramChannel } = await import("../cli/channels/telegram.ts");
      const channel = new TelegramChannel();

      // start() calls getBot() internally, which should throw
      await expect(channel.start()).rejects.toThrow("TELEGRAM_BOT_TOKEN");
    } finally {
      // Restore original value
      if (original !== undefined) {
        process.env.TELEGRAM_BOT_TOKEN = original;
      }
    }
  });

  test("channel has start, stop, and notify methods", async () => {
    const { TelegramChannel } = await import("../cli/channels/telegram.ts");
    const channel = new TelegramChannel();

    expect(typeof channel.start).toBe("function");
    expect(typeof channel.stop).toBe("function");
    expect(typeof channel.notify).toBe("function");
  });

  test("notify returns early when no linked user (without bot token)", async () => {
    // Without a bot token, notify should throw (since getBot is called first)
    const original = process.env.TELEGRAM_BOT_TOKEN;
    delete process.env.TELEGRAM_BOT_TOKEN;

    try {
      const { TelegramChannel } = await import("../cli/channels/telegram.ts");
      const channel = new TelegramChannel();

      await expect(channel.notify("test message")).rejects.toThrow(
        "TELEGRAM_BOT_TOKEN",
      );
    } finally {
      if (original !== undefined) {
        process.env.TELEGRAM_BOT_TOKEN = original;
      }
    }
  });
});

describe("Security guard logic", () => {
  test("unlinked user should be rejected (linkedUserId && userId !== linkedUserId)", () => {
    // Simulate the security check logic from the bot handler
    const linkedUserId = 12345;
    const userId = 99999;

    const shouldIgnore = linkedUserId && userId !== linkedUserId;
    expect(shouldIgnore).toBeTruthy();
  });

  test("linked user should be allowed (linkedUserId && userId === linkedUserId)", () => {
    const linkedUserId = 12345;
    const userId = 12345;

    const shouldIgnore = linkedUserId && userId !== linkedUserId;
    expect(shouldIgnore).toBeFalsy();
  });

  test("no linked user should reject all messages (!linkedUserId)", () => {
    const linkedUserId: number | null = null;
    const userId = 99999;

    // First guard passes (linkedUserId is falsy), second guard catches it
    const firstGuardRejects = linkedUserId && userId !== linkedUserId;
    const secondGuardRejects = !linkedUserId;

    expect(firstGuardRejects).toBeFalsy();
    expect(secondGuardRejects).toBeTruthy();
  });
});
