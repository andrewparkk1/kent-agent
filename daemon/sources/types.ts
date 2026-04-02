/** Shared types for all data sources. Each source implements Source.fetchNew(). */
export interface Item {
  source: string;
  externalId: string;
  content: string;
  metadata: Record<string, any>;
  createdAt: number;
}

export interface SyncState {
  getLastSync(source: string): number;
  markSynced(source: string, highWaterMark?: number): void;
}

export interface SyncOptions {
  /** Override the default days-back for first sync (default: 365). 0 = everything. */
  defaultDays?: number;
  /** Override per-batch row limit. */
  limit?: number;
  /** Called periodically with the number of items fetched so far. */
  onProgress?: (count: number) => void;
}

export interface Source {
  name: string;
  fetchNew(state: SyncState, options?: SyncOptions): Promise<Item[]>;
}
