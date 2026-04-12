import { test, expect, describe } from "bun:test";
import { MockSyncState, validateItem, LIVE } from "./_helpers.ts";
import {
  appleMusic,
  createAppleMusicSource,
  _parseAppleScriptOutput,
  _tracksToItems,
} from "@daemon/sources/apple-music.ts";

const SEP = "<<<SEP>>>";
const DELIM = "<<<TRACK>>>";

function row(fields: {
  trackId: string;
  name: string;
  artist: string;
  album: string;
  duration?: number;
  genre?: string;
  rating?: number;
  plays?: number;
  playedAt: string;
}): string {
  return [
    fields.trackId,
    fields.name,
    fields.artist,
    fields.album,
    String(fields.duration ?? 180),
    fields.genre ?? "",
    String(fields.rating ?? 0),
    String(fields.plays ?? 1),
    fields.playedAt,
  ].join(SEP);
}

function stdout(...rows: string[]): string {
  return rows.map((r) => DELIM + r).join("") + "\n";
}

describe("apple-music source", () => {
  test("exports stable name and factory", () => {
    expect(appleMusic.name).toBe("apple-music");
    expect(typeof appleMusic.fetchNew).toBe("function");
    expect(typeof createAppleMusicSource).toBe("function");
  });

  test("parses canned tracks stdout into exact items", async () => {
    const canned = stdout(
      row({
        trackId: "1001",
        name: "Levitating",
        artist: "Dua Lipa",
        album: "Future Nostalgia",
        duration: 203,
        genre: "Pop",
        rating: 100,
        plays: 42,
        playedAt: "2025-06-10T08:00:00",
      }),
      row({
        trackId: "1002",
        name: "Blinding Lights",
        artist: "The Weeknd",
        album: "After Hours",
        duration: 200,
        genre: "Pop",
        rating: 80,
        plays: 15,
        playedAt: "2025-06-10T08:05:00",
      }),
      row({
        trackId: "1003",
        name: "Chinese New Year",
        artist: "SALES",
        album: "Forever & Ever",
        duration: 150,
        genre: "Indie",
        rating: 0,
        plays: 3,
        playedAt: "2025-06-09T22:30:00",
      }),
    );

    const src = createAppleMusicSource({
      exec: async () => canned,
      now: () => Date.parse("2025-06-10T09:00:00Z"),
    });
    const items = await src.fetchNew(new MockSyncState());

    expect(items).toHaveLength(3);
    for (const item of items) validateItem(item, "apple-music", /^apple-music-/);

    const [a, b, c] = items;
    expect(a!.externalId).toBe("apple-music-1001-2025-06-10T08:00:00");
    expect(a!.content).toBe("Levitating by Dua Lipa \u2014 Future Nostalgia");
    expect(a!.metadata.trackName).toBe("Levitating");
    expect(a!.metadata.artist).toBe("Dua Lipa");
    expect(a!.metadata.album).toBe("Future Nostalgia");
    expect(a!.metadata.duration).toBe(203);
    expect(a!.metadata.genre).toBe("Pop");
    expect(a!.metadata.rating).toBe(100);
    expect(a!.metadata.playCount).toBe(42);
    expect(a!.metadata.playedAt).toBe("2025-06-10T08:00:00");
    expect(a!.createdAt).toBe(
      Math.floor(new Date("2025-06-10T08:00:00").getTime() / 1000),
    );

    expect(b!.externalId).toBe("apple-music-1002-2025-06-10T08:05:00");
    expect(b!.content).toContain("Blinding Lights by The Weeknd");

    expect(c!.externalId).toBe("apple-music-1003-2025-06-09T22:30:00");
    expect(c!.metadata.rating).toBe(0);
    expect(c!.metadata.playCount).toBe(3);
  });

  test("parseAppleScriptOutput handles empty / malformed", () => {
    expect(_parseAppleScriptOutput("")).toEqual([]);
    expect(_parseAppleScriptOutput(DELIM + "a" + SEP + "b")).toEqual([]);
  });

  test("tracksToItems drops tracks with blank name", () => {
    const items = _tracksToItems(
      [
        {
          trackId: "X",
          trackName: "",
          artist: "Nobody",
          album: "None",
          duration: 0,
          genre: "",
          rating: 0,
          playCount: 0,
          playedAt: "2025-01-01T00:00:00",
        },
      ],
      Date.parse("2025-06-10T00:00:00Z"),
    );
    expect(items).toEqual([]);
  });

  test("fetchNew returns [] when exec throws (no permission)", async () => {
    const src = createAppleMusicSource({
      exec: async () => {
        throw new Error("Music not running");
      },
    });
    expect(await src.fetchNew(new MockSyncState())).toEqual([]);
  });

  test.skipIf(!LIVE)("LIVE: exported appleMusic returns an array", async () => {
    const items = await appleMusic.fetchNew(new MockSyncState());
    expect(Array.isArray(items)).toBe(true);
  }, 60_000);
});
