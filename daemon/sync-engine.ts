import type { Source, SyncState } from "./sources/types";
import { FileSyncState } from "./sync-state";

export class SyncEngine {
  private state: SyncState;

  constructor(
    private sources: Source[],
    private convexClient: any,
    private deviceToken: string
  ) {
    this.state = new FileSyncState();
  }

  async runOnce(): Promise<void> {
    for (const source of this.sources) {
      try {
        const items = await source.fetchNew(this.state);
        if (items.length > 0) {
          console.log(`[sync] ${source.name}: ${items.length} new items`);
          await this.convexClient.mutation("items:batchUpsert", {
            deviceToken: this.deviceToken,
            items,
          });
        }
        this.state.markSynced(source.name);
      } catch (e) {
        console.error(`[sync] ${source.name}: ${e}`);
      }
    }
  }

  async runForever(intervalMs: number): Promise<void> {
    console.log(
      `[sync] Starting sync loop (interval: ${intervalMs / 1000}s, sources: ${this.sources.map((s) => s.name).join(", ")})`
    );
    while (true) {
      await this.runOnce();
      await Bun.sleep(intervalMs);
    }
  }
}
