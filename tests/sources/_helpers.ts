import { expect } from "bun:test";
import type { SyncState, Item } from "@daemon/sources/types.ts";

export class MockSyncState implements SyncState {
  private timestamps: Record<string, number> = {};
  getLastSync(source: string): number { return this.timestamps[source] || 0; }
  markSynced(source: string, hwm?: number): void {
    this.timestamps[source] = hwm ?? Math.floor(Date.now() / 1000);
  }
  resetSync(source: string, ts: number): void { this.timestamps[source] = ts; }
}

export function validateItem(item: Item, expectedSource: string, idPattern: RegExp) {
  expect(item.source).toBe(expectedSource);
  expect(item.externalId).toBeString();
  expect(item.externalId).toMatch(idPattern);
  expect(typeof item.content).toBe("string");
  expect(typeof item.createdAt).toBe("number");
  expect(item.createdAt).toBeGreaterThan(0);
  expect(item.metadata).toBeDefined();
  expect(typeof item.metadata).toBe("object");
}

/** Set KENT_LIVE_TESTS=1 to run tests that hit your real local data / API tokens. */
export const LIVE = !!process.env.KENT_LIVE_TESTS;
