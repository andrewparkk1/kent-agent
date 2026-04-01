/**
 * Tracks the last successful sync timestamp per source in ~/.kent/state.json.
 * Sources use this to only fetch items newer than the last sync (incremental sync).
 * Writes are atomic (write to .tmp then rename) to avoid corruption.
 */
import { join } from "path";
import { homedir } from "os";
import {
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  renameSync,
} from "fs";
import type { SyncState } from "./sources/types";

const KENT_DIR = join(homedir(), ".kent");
const STATE_PATH = join(KENT_DIR, "state.json");

interface StateData {
  lastSync: Record<string, number>;
}

export class FileSyncState implements SyncState {
  private data: StateData;

  constructor() {
    this.data = this.load();
  }

  private load(): StateData {
    try {
      if (existsSync(STATE_PATH)) {
        const raw = readFileSync(STATE_PATH, "utf-8");
        const parsed = JSON.parse(raw);
        return {
          lastSync: parsed.lastSync || {},
        };
      }
    } catch (e) {
      console.warn(`[sync-state] Failed to load state, starting fresh: ${e}`);
    }
    return { lastSync: {} };
  }

  private save(): void {
    try {
      mkdirSync(KENT_DIR, { recursive: true });

      // Atomic write: write to temp file then rename
      const tempPath = STATE_PATH + ".tmp";
      writeFileSync(tempPath, JSON.stringify(this.data, null, 2), "utf-8");
      renameSync(tempPath, STATE_PATH);
    } catch (e) {
      console.error(`[sync-state] Failed to save state: ${e}`);
    }
  }

  getLastSync(source: string): number {
    return this.data.lastSync[source] || 0;
  }

  markSynced(source: string): void {
    this.data.lastSync[source] = Math.floor(Date.now() / 1000);
    this.save();
  }
}
