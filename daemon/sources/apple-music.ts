/**
 * Apple Music — reads recently played tracks via AppleScript.
 *
 * Queries the Music app for tracks played since the last sync and returns
 * each play as an Item with track metadata.
 */
import type { Source, SyncState, SyncOptions, Item } from "./types";

// ---------------------------------------------------------------------------
// AppleScript builder
// ---------------------------------------------------------------------------

/**
 * Build AppleScript to fetch tracks played in the last N days.
 * The script is a static template — only DAYS_BACK (a number) is interpolated.
 */
function buildAppleScript(daysBack: number): string {
  return `
tell application "Music"
  set output to ""
  set sep to "<<<SEP>>>"
  set delim to "<<<TRACK>>>"
  set recentTracks to (every track whose played date > (current date) - ${Math.floor(daysBack)} * days)
  repeat with t in recentTracks
    try
      set trackName to name of t
      set trackArtist to artist of t
      set trackAlbum to album of t
      set trackDuration to duration of t
      set trackGenre to genre of t
      set trackRating to rating of t
      set trackPlayCount to played count of t
      set trackPlayDate to played date of t as <<class isot>> as string
      set trackId to database ID of t
      set output to output & delim & trackId & sep & trackName & sep & trackArtist & sep & trackAlbum & sep & trackDuration & sep & trackGenre & sep & trackRating & sep & trackPlayCount & sep & trackPlayDate
    end try
  end repeat
  return output
end tell
`;
}

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

interface ParsedTrack {
  trackId: string;
  trackName: string;
  artist: string;
  album: string;
  duration: number;
  genre: string;
  rating: number;
  playCount: number;
  playedAt: string;
}

function parseAppleScriptOutput(raw: string): ParsedTrack[] {
  const tracks: ParsedTrack[] = [];
  const chunks = raw.split("<<<TRACK>>>").filter(Boolean);

  for (const chunk of chunks) {
    const parts = chunk.split("<<<SEP>>>");
    if (parts.length < 9) continue;

    const [trackId, trackName, artist, album, durationStr, genre, ratingStr, playCountStr, playedAt] = parts;

    tracks.push({
      trackId: trackId!.trim(),
      trackName: trackName!.trim(),
      artist: artist!.trim(),
      album: album!.trim(),
      duration: parseFloat(durationStr!.trim()) || 0,
      genre: genre!.trim(),
      rating: parseInt(ratingStr!.trim(), 10) || 0,
      playCount: parseInt(playCountStr!.trim(), 10) || 0,
      playedAt: playedAt!.trim(),
    });
  }

  return tracks;
}

// ---------------------------------------------------------------------------
// Fetcher
// ---------------------------------------------------------------------------

async function fetchViaAppleScript(lastSyncEpoch: number): Promise<Item[]> {
  const now = Date.now() / 1000;
  const secondsSinceSync = lastSyncEpoch > 0 ? now - lastSyncEpoch : 365 * 24 * 3600;
  const daysBack = Math.max(1, Math.ceil(secondsSinceSync / 86400) + 1);

  const script = buildAppleScript(Math.min(daysBack, 365));

  // osascript with static script — no user input reaches the shell
  const proc = Bun.spawn(["osascript", "-e", script], {
    stdout: "pipe",
    stderr: "pipe",
  });

  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  await proc.exited;

  if (proc.exitCode !== 0) {
    throw new Error(`AppleScript failed (exit ${proc.exitCode}): ${stderr.slice(0, 200)}`);
  }

  const tracks = parseAppleScriptOutput(stdout);

  return tracks
    .filter((t) => t.trackName)
    .map((t) => {
      const playDate = new Date(t.playedAt);
      const createdAt = !isNaN(playDate.getTime())
        ? Math.floor(playDate.getTime() / 1000)
        : Math.floor(Date.now() / 1000);

      return {
        source: "apple-music",
        externalId: `apple-music-${t.trackId}-${t.playedAt}`,
        content: `${t.trackName} by ${t.artist} \u2014 ${t.album}`,
        metadata: {
          trackName: t.trackName,
          artist: t.artist,
          album: t.album,
          duration: t.duration,
          genre: t.genre,
          rating: t.rating,
          playCount: t.playCount,
          playedAt: t.playedAt,
        },
        createdAt,
      };
    });
}

// ---------------------------------------------------------------------------
// Source implementation
// ---------------------------------------------------------------------------

export const appleMusic: Source = {
  name: "apple-music",

  async fetchNew(state: SyncState, _options?: SyncOptions): Promise<Item[]> {
    try {
      const lastSync = state.getLastSync("apple-music");
      return await fetchViaAppleScript(lastSync);
    } catch (e) {
      console.warn(`[apple-music] Failed to fetch tracks: ${e}`);
      return [];
    }
  },
};
