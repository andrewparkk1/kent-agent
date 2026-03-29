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

  // Fetch all sources in parallel, then upload batches
  const { ConvexHttpClient } = await import("convex/browser");
  const client = new ConvexHttpClient(KENT_CONVEX_URL);
  const BATCH_SIZE = 100;

  const results = await Promise.allSettled(
    sourcesToSync.map(async (source) => {
      const items = await source.fetchNew(state);
      console.log(`Syncing ${source.name}... ${items.length} new items`);

      if (items.length > 0) {
        // Batch uploads to stay within Convex read limits (4096 per mutation)
        for (let i = 0; i < items.length; i += BATCH_SIZE) {
          const batch = items.slice(i, i + BATCH_SIZE);
          await client.mutation("items:batchUpsert" as any, {
            deviceToken: config.core.device_token,
            items: batch,
          });
        }
      }

      state.markSynced(source.name);
      return { source: source.name, count: items.length };
    })
  );

  for (const result of results) {
    if (result.status === "rejected") {
      console.error(`Error syncing: ${result.reason}`);
    }
  }

  console.log("Sync complete.");
  process.exit(0);
}
