import { join } from "path";
import { homedir } from "os";
import { readdirSync, readFileSync, statSync, existsSync } from "fs";
import type { Source, SyncState, Item } from "./types";

const GRANOLA_DIR = join(
  homedir(),
  "Library/Application Support/Granola"
);

export const granola: Source = {
  name: "granola",

  async fetchNew(state: SyncState): Promise<Item[]> {
    try {
      if (!existsSync(GRANOLA_DIR)) {
        console.warn("[granola] Granola directory not found, skipping");
        return [];
      }

      const lastSync = state.getLastSync("granola");
      const items: Item[] = [];

      const files = readdirSync(GRANOLA_DIR).filter((f) =>
        f.endsWith(".json")
      );

      for (const file of files) {
        try {
          const filePath = join(GRANOLA_DIR, file);
          const stat = statSync(filePath);
          const modifiedAt = Math.floor(stat.mtimeMs / 1000);

          if (modifiedAt <= lastSync) continue;

          const raw = readFileSync(filePath, "utf-8");
          const data = JSON.parse(raw);

          const title = data.title || data.name || file;
          const participants: string[] = data.participants || data.attendees || [];

          const contentParts: string[] = [];
          if (title) contentParts.push(`# ${title}`);
          if (participants.length > 0)
            contentParts.push(`Participants: ${participants.join(", ")}`);
          if (data.summary) contentParts.push(`## Summary\n${data.summary}`);
          if (data.notes) contentParts.push(`## Notes\n${data.notes}`);
          if (data.transcript)
            contentParts.push(`## Transcript\n${data.transcript}`);

          items.push({
            source: "granola",
            externalId: `granola-${file}`,
            content: contentParts.join("\n\n"),
            metadata: {
              title,
              participants,
              fileName: file,
              hasSummary: !!data.summary,
              hasTranscript: !!data.transcript,
              hasNotes: !!data.notes,
            },
            createdAt: data.createdAt
              ? Math.floor(new Date(data.createdAt).getTime() / 1000)
              : modifiedAt,
          });
        } catch (e) {
          console.warn(`[granola] Failed to parse ${file}: ${e}`);
        }
      }

      return items;
    } catch (e) {
      console.warn(`[granola] Failed to read meetings: ${e}`);
      return [];
    }
  },
};
