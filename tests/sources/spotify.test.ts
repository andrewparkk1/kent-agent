import { test, expect, describe } from "bun:test";
import { MockSyncState, validateItem, LIVE } from "./_helpers.ts";
import { createSpotifySource, spotify } from "@daemon/sources/spotify.ts";

// ─── Fixtures ─────────────────────────────────────────────────────────────

const RECENT = {
  items: [
    {
      played_at: "2023-11-14T10:00:00Z",
      track: {
        id: "tr1",
        name: "Song A",
        duration_ms: 210000,
        artists: [{ name: "Artist One" }, { name: "Artist Two" }],
        album: { name: "Album X" },
        external_urls: { spotify: "https://open.spotify.com/track/tr1" },
      },
    },
    {
      played_at: "2023-11-14T09:00:00Z",
      track: {
        id: "tr2",
        name: "Song B",
        duration_ms: 180000,
        artists: [{ name: "Solo Artist" }],
        album: { name: "Album Y" },
        external_urls: { spotify: "https://open.spotify.com/track/tr2" },
      },
    },
  ],
};

const TOP = {
  items: [
    {
      id: "tr10",
      name: "Top Hit",
      popularity: 99,
      artists: [{ name: "Pop Star" }],
      album: { name: "Greatest Hits" },
    },
    {
      id: "tr11",
      name: "Banger",
      popularity: 88,
      artists: [{ name: "DJ X" }, { name: "Vocalist" }],
      album: { name: "EP" },
    },
  ],
};

function makeFetcher(): typeof fetch {
  return (async (input: any): Promise<Response> => {
    const url = typeof input === "string" ? input : input.url ?? input.toString();
    const json = (d: any) =>
      new Response(JSON.stringify(d), {
        headers: { "content-type": "application/json" },
      });
    if (url.startsWith("https://api.spotify.com/v1/me/player/recently-played")) {
      return json(RECENT);
    }
    if (url.startsWith("https://api.spotify.com/v1/me/top/tracks")) {
      return json(TOP);
    }
    if (url === "https://accounts.spotify.com/api/token") {
      return json({ access_token: "atoken", expires_in: 3600 });
    }
    return new Response("", { status: 404 });
  }) as unknown as typeof fetch;
}

describe("spotify source (mocked)", () => {
  test("exported spotify still conforms to Source interface", () => {
    expect(spotify.name).toBe("spotify");
    expect(typeof spotify.fetchNew).toBe("function");
  });

  test("returns empty array when no credentials/token", async () => {
    const src = createSpotifySource({
      credentials: null,
      fetcher: makeFetcher(),
    });
    const items = await src.fetchNew(new MockSyncState());
    expect(items).toEqual([]);
  });

  test("parses recently-played and top tracks with exact externalIds", async () => {
    const fixedNow = Date.parse("2023-11-14T12:00:00Z");
    const src = createSpotifySource({
      accessToken: "mock-token",
      fetcher: makeFetcher(),
      now: () => fixedNow,
    });
    const items = await src.fetchNew(new MockSyncState());

    for (const item of items) validateItem(item, "spotify", /^spotify-/);

    expect(items.length).toBe(4);

    const play1 = items.find(
      (i) => i.externalId === "spotify-play-tr1-2023-11-14T10:00:00Z",
    )!;
    expect(play1).toBeDefined();
    expect(play1.content).toBe("Song A by Artist One, Artist Two — Album X");
    expect(play1.metadata.type).toBe("play");
    expect(play1.metadata.trackName).toBe("Song A");
    expect(play1.metadata.artists).toEqual(["Artist One", "Artist Two"]);
    expect(play1.metadata.albumName).toBe("Album X");
    expect(play1.metadata.durationMs).toBe(210000);
    expect(play1.metadata.playedAt).toBe("2023-11-14T10:00:00Z");
    expect(play1.metadata.trackUrl).toBe("https://open.spotify.com/track/tr1");
    expect(play1.createdAt).toBe(Math.floor(Date.parse("2023-11-14T10:00:00Z") / 1000));

    const play2 = items.find(
      (i) => i.externalId === "spotify-play-tr2-2023-11-14T09:00:00Z",
    )!;
    expect(play2).toBeDefined();
    expect(play2.content).toBe("Song B by Solo Artist — Album Y");

    const top1 = items.find((i) => i.externalId === "spotify-top-tr10")!;
    expect(top1).toBeDefined();
    expect(top1.content).toBe("Top track: Top Hit by Pop Star");
    expect(top1.metadata.type).toBe("top_track");
    expect(top1.metadata.popularity).toBe(99);
    expect(top1.createdAt).toBe(Math.floor(fixedNow / 1000));

    const top2 = items.find((i) => i.externalId === "spotify-top-tr11")!;
    expect(top2).toBeDefined();
    expect(top2.metadata.artists).toEqual(["DJ X", "Vocalist"]);
  });

  test("refreshes access token from credentials when no accessToken provided", async () => {
    let tokenFetched = false;
    const fetcher: typeof fetch = (async (input: any): Promise<Response> => {
      const url = typeof input === "string" ? input : input.url ?? input.toString();
      if (url === "https://accounts.spotify.com/api/token") {
        tokenFetched = true;
        return new Response(
          JSON.stringify({ access_token: "fresh", expires_in: 3600 }),
          { headers: { "content-type": "application/json" } },
        );
      }
      return makeFetcher()(input);
    }) as unknown as typeof fetch;

    const src = createSpotifySource({
      credentials: { clientId: "cid", clientSecret: "cs", refreshToken: "rt" },
      fetcher,
    });
    const items = await src.fetchNew(new MockSyncState());
    expect(tokenFetched).toBe(true);
    expect(items.length).toBe(4);
  });

  test.skipIf(!LIVE)("LIVE: pulls recent + top tracks", async () => {
    const items = await spotify.fetchNew(new MockSyncState(), { limit: 10 });
    for (const item of items) validateItem(item, "spotify", /^spotify-/);
  }, 120_000);
});
