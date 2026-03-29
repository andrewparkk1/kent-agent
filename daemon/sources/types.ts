export interface Item {
  source: string;
  externalId: string;
  content: string;
  metadata: Record<string, any>;
  createdAt: number;
}

export interface SyncState {
  getLastSync(source: string): number;
  markSynced(source: string): void;
}

export interface Source {
  name: string;
  fetchNew(state: SyncState): Promise<Item[]>;
}
