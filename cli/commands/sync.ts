import { loadConfig, KENT_CONVEX_URL } from "@shared/config.ts";
import { FileSyncState } from "@daemon/sync-state.ts";
import type { Source } from "@daemon/sources/types.ts";
import { imessage } from "@daemon/sources/imessage.ts";
import { signal } from "@daemon/sources/signal.ts";
import { granola } from "@daemon/sources/granola.ts";
import { gmail } from "@daemon/sources/gmail.ts";
import { github } from "@daemon/sources/github.ts";
import { chrome } from "@daemon/sources/chrome.ts";
import { appleNotes } from "@daemon/sources/apple-notes.ts";

/**
 * Map of source name → Source implementation.
 * Keys match the config.sources field names.
 */
const sourceRegistry: Record<string, Source> = {
  imessage,
  signal,
  granola,
  gmail,
  github,
  chrome,
  apple_notes: appleNotes,
};

export async function handleSync(args: string[]): Promise<void> {
  const sourceIdx = args.indexOf("--source");
  const sourceFilter = sourceIdx !== -1 ? args[sourceIdx + 1] : undefined;

  const config = loadConfig();
  const state = new FileSyncState();

  // Determine which sources to sync
  let sourcesToSync: Source[];

  if (sourceFilter) {
    const source = sourceRegistry[sourceFilter];
    if (!source) {
      const available = Object.keys(sourceRegistry).join(", ");
      console.error(`Unknown source: "${sourceFilter}". Available: ${available}`);
      process.exit(1);
    }
    sourcesToSync = [source];
  } else {
    // Sync all enabled sources from config
    sourcesToSync = [];
    for (const [key, source] of Object.entries(sourceRegistry)) {
      const configKey = key as keyof typeof config.sources;
      if (config.sources[configKey]) {
        sourcesToSync.push(source);
      }
    }

    if (sourcesToSync.length === 0) {
      console.log("No sources enabled. Enable sources in ~/.kent/config.json under 'sources'.");
      process.exit(0);
    }
  }

  // Run sync for each source
  for (const source of sourcesToSync) {
    try {
      const items = await source.fetchNew(state);
      console.log(`Syncing ${source.name}... ${items.length} new items`);

      if (items.length > 0) {
        {
          // Use the SyncEngine's Convex client approach
          const { ConvexHttpClient } = await import("convex/browser");
          const client = new ConvexHttpClient(KENT_CONVEX_URL);
          await client.mutation("items:batchUpsert" as any, {
            deviceToken: config.core.device_token,
            items,
          });
        }
      }

      state.markSynced(source.name);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`Error syncing ${source.name}: ${msg}`);
    }
  }

  console.log("Sync complete.");
  process.exit(0);
}
