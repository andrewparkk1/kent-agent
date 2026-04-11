/**
 * Spotify source — pulls recently played tracks and top tracks via the
 * Spotify Web API. Requires a client ID, client secret, and refresh token
 * (configured in config.json keys or environment variables).
 */
import type { Source, SyncState, SyncOptions, Item } from "./types";
import { loadConfig } from "@shared/config.ts";

// --- Token cache -----------------------------------------------------------

let cachedAccessToken: string | null = null;
let tokenExpiresAt = 0;

function getCredentials(): {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
} | null {
  const config = loadConfig();
  const keys = config.keys as Record<string, any>;

  const clientId =
    (keys.spotify_client_id as string | undefined) ||
    process.env.SPOTIFY_CLIENT_ID ||
    "";
  const clientSecret =
    (keys.spotify_client_secret as string | undefined) ||
    process.env.SPOTIFY_CLIENT_SECRET ||
    "";
  const refreshToken =
    (keys.spotify_refresh_token as string | undefined) ||
    process.env.SPOTIFY_REFRESH_TOKEN ||
    "";

  if (!clientId || !clientSecret || !refreshToken) return null;
  return { clientId, clientSecret, refreshToken };
}

async function getAccessToken(creds: {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
}): Promise<string | null> {
  if (cachedAccessToken && Date.now() < tokenExpiresAt) {
    return cachedAccessToken;
  }

  try {
    const basic = btoa(`${creds.clientId}:${creds.clientSecret}`);
    const res = await fetch("https://accounts.spotify.com/api/token", {
      method: "POST",
      headers: {
        Authorization: `Basic ${basic}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: creds.refreshToken,
      }),
    });

    if (!res.ok) return null;

    const data = (await res.json()) as {
      access_token: string;
      expires_in: number;
    };
    cachedAccessToken = data.access_token;
    // Expire 60 s early to avoid edge cases
    tokenExpiresAt = Date.now() + (data.expires_in - 60) * 1000;
    return cachedAccessToken;
  } catch {
    return null;
  }
}

// --- Spotify API helpers ---------------------------------------------------

async function spotifyGet(
  token: string,
  url: string,
): Promise<any | null> {
  try {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

// --- Source implementation --------------------------------------------------

export const spotify: Source = {
  name: "spotify",

  async fetchNew(state: SyncState, options?: SyncOptions): Promise<Item[]> {
    const creds = getCredentials();
    if (!creds) return [];

    const token = await getAccessToken(creds);
    if (!token) return [];

    const lastSync = state.getLastSync("spotify");
    const items: Item[] = [];

    // --- Recently played ---------------------------------------------------
    let recentUrl =
      "https://api.spotify.com/v1/me/player/recently-played?limit=50";
    if (lastSync > 0) {
      // Spotify expects unix ms for the `after` param
      recentUrl += `&after=${lastSync * 1000}`;
    }

    const [recentData, topData] = await Promise.all([
      spotifyGet(token, recentUrl),
      spotifyGet(
        token,
        "https://api.spotify.com/v1/me/top/tracks?time_range=short_term&limit=50",
      ),
    ]);

    if (recentData?.items && Array.isArray(recentData.items)) {
      for (const entry of recentData.items) {
        const track = entry.track;
        if (!track) continue;

        const playedAt: string = entry.played_at ?? "";
        const artists: string[] = (track.artists ?? []).map(
          (a: any) => a.name as string,
        );
        const artistStr = artists.join(", ");
        const albumName: string = track.album?.name ?? "";
        const trackName: string = track.name ?? "";

        const createdAt = playedAt
          ? Math.floor(new Date(playedAt).getTime() / 1000)
          : Math.floor(Date.now() / 1000);

        items.push({
          source: "spotify",
          externalId: `spotify-play-${track.id}-${playedAt}`,
          content: `${trackName} by ${artistStr} — ${albumName}`,
          metadata: {
            type: "play",
            trackName,
            artists,
            albumName,
            durationMs: track.duration_ms ?? 0,
            playedAt,
            trackUrl: track.external_urls?.spotify ?? "",
          },
          createdAt,
        });
      }
    }

    // --- Top tracks --------------------------------------------------------
    if (topData?.items && Array.isArray(topData.items)) {
      const now = Math.floor(Date.now() / 1000);

      for (const track of topData.items) {
        if (!track) continue;

        const artists: string[] = (track.artists ?? []).map(
          (a: any) => a.name as string,
        );
        const artistStr = artists.join(", ");
        const trackName: string = track.name ?? "";
        const albumName: string = track.album?.name ?? "";

        items.push({
          source: "spotify",
          externalId: `spotify-top-${track.id}`,
          content: `Top track: ${trackName} by ${artistStr}`,
          metadata: {
            type: "top_track",
            trackName,
            artists,
            albumName,
            popularity: track.popularity ?? 0,
          },
          createdAt: now,
        });
      }
    }

    return items;
  },
};
