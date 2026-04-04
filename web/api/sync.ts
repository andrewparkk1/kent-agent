/** POST /api/sync — trigger a sync for a specific source with optional since date. */
import { upsertItems } from "../../shared/db.ts";
import { loadConfig } from "../../shared/config.ts";
import { FileSyncState } from "../../daemon/sync-state.ts";
import type { Source } from "../../daemon/sources/types.ts";
import { imessage } from "../../daemon/sources/imessage.ts";
import { signal } from "../../daemon/sources/signal.ts";
import { granola } from "../../daemon/sources/granola.ts";
import { gmail, gcal, gtasks, gdrive } from "../../daemon/sources/gmail.ts";
import { github } from "../../daemon/sources/github.ts";
import { chrome } from "../../daemon/sources/chrome.ts";
import { appleNotes } from "../../daemon/sources/apple-notes.ts";

const sourceRegistry: Record<string, Source> = {
  imessage,
  signal,
  granola,
  gmail,
  gcal,
  gtasks,
  gdrive,
  github,
  chrome,
  apple_notes: appleNotes,
};

export async function handleSync(req: Request): Promise<Response> {
  const body = await req.json() as { source: string; since?: number };
  const { source: sourceKey, since } = body;

  if (!sourceKey) {
    return Response.json({ error: "source is required" }, { status: 400 });
  }

  const source = sourceRegistry[sourceKey];
  if (!source) {
    return Response.json({ error: `Unknown source: ${sourceKey}` }, { status: 400 });
  }

  const config = loadConfig();
  const configKey = sourceKey as keyof typeof config.sources;
  if (!config.sources[configKey]) {
    return Response.json({ error: `Source "${sourceKey}" is not enabled` }, { status: 400 });
  }

  const syncState = new FileSyncState();

  // If a `since` timestamp is provided, temporarily override the sync state
  // so the source fetches from that point
  const originalLastSync = syncState.getLastSync(source.name);
  if (since !== undefined) {
    syncState.resetSync(source.name, since);
  }

  try {
    const items = await source.fetchNew(syncState);

    if (items.length > 0) {
      const dbItems = items.map((item) => ({
        source: item.source,
        external_id: item.externalId,
        content: item.content,
        metadata: item.metadata,
        created_at: item.createdAt,
      }));
      upsertItems(dbItems);

      const maxCreatedAt = Math.max(...items.map((i) => i.createdAt));
      syncState.markSynced(source.name, maxCreatedAt);
    } else if (since === undefined) {
      // No override and no items — don't advance cursor
    }

    return Response.json({
      source: sourceKey,
      itemCount: items.length,
      message: items.length > 0
        ? `Synced ${items.length} items from ${sourceKey}`
        : `No new items from ${sourceKey}`,
    });
  } catch (e) {
    // Restore original sync state on error
    if (since !== undefined) {
      syncState.markSynced(source.name, originalLastSync);
    }
    return Response.json({ error: String(e) }, { status: 500 });
  }
}
