import { loadConfig } from "@shared/config.ts";
import { upsertItems } from "@shared/db.ts";
import { FileSyncState } from "@daemon/sync-state.ts";
import type { Source } from "@daemon/sources/types.ts";
import { imessage } from "@daemon/sources/imessage.ts";
import { signal } from "@daemon/sources/signal.ts";
import { granola } from "@daemon/sources/granola.ts";
import { gmail } from "@daemon/sources/gmail.ts";
import { github } from "@daemon/sources/github.ts";
import { chrome } from "@daemon/sources/chrome.ts";
import { appleNotes } from "@daemon/sources/apple-notes.ts";

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

  // Sync sources sequentially so output is readable
  for (const source of sourcesToSync) {
    process.stdout.write(`  Syncing ${source.name}...`);
    try {
      const start = performance.now();
      const items = await source.fetchNew(state);
      const fetchMs = Math.round(performance.now() - start);

      if (items.length > 0) {
        process.stdout.write(` ${items.length} items, saving...`);
        const dbStart = performance.now();
        const dbItems = items.map((item) => ({
          source: item.source,
          external_id: item.externalId,
          content: item.content,
          metadata: item.metadata,
          created_at: item.createdAt,
        }));
        upsertItems(dbItems);
        const dbMs = Math.round(performance.now() - dbStart);
        console.log(` done (${fetchMs}ms fetch, ${dbMs}ms save)`);
      } else {
        console.log(` 0 items (${fetchMs}ms)`);
      }

      state.markSynced(source.name);
    } catch (e) {
      console.log(` error: ${e instanceof Error ? e.message : e}`);
    }
  }

  console.log("  Sync complete.");
  process.exit(0);
}
