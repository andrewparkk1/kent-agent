/** Items — synced data from all sources with FTS5 full-text search. */
import { sql } from "kysely";
import { getDb, getRawDb } from "./connection.ts";
import type { Item } from "./schema.ts";

export type { Item };

export interface DbItem {
  source: string;
  external_id: string;
  content: string;
  metadata: Record<string, any>;
  created_at: number;
}

/** Batch upsert items using raw bun:sqlite for performance (transactions + prepared statements). */
export function upsertItems(items: DbItem[]): number {
  const raw = getRawDb();
  const stmt = raw.prepare(`
    INSERT INTO items (source, external_id, content, metadata, created_at)
    VALUES ($source, $external_id, $content, $metadata, $created_at)
    ON CONFLICT(source, external_id) DO UPDATE SET
      content = excluded.content,
      metadata = excluded.metadata,
      synced_at = CASE
        WHEN items.content != excluded.content OR items.metadata != excluded.metadata
        THEN unixepoch()
        ELSE items.synced_at
      END
  `);

  let count = 0;
  const tx = raw.transaction(() => {
    for (const item of items) {
      stmt.run({
        $source: item.source,
        $external_id: item.external_id,
        $content: item.content,
        $metadata: JSON.stringify(item.metadata),
        $created_at: item.created_at,
      });
      count++;
    }
  });
  tx();
  return count;
}

/** FTS5 full-text search across items. Uses raw SQL because Kysely doesn't support FTS5 MATCH. */
export function searchItems(query: string, limit = 50, source?: string): Array<DbItem & { id: number; rank: number }> {
  const sanitized = query.replace(/['"()*:^~]/g, " ").trim();
  if (!sanitized) return [];

  const ftsQuery = sanitized.split(/\s+/).map((w) => `"${w}"*`).join(" ");
  const sourceFilter = source ? "AND i.source = $source" : "";

  const rows = getRawDb()
    .prepare(`
      SELECT i.id, i.source, i.external_id, i.content, i.metadata, i.created_at, f.rank
      FROM items_fts f JOIN items i ON i.id = f.rowid
      WHERE items_fts MATCH $query ${sourceFilter}
      ORDER BY f.rank LIMIT $limit
    `)
    .all({ $query: ftsQuery, $limit: limit, ...(source ? { $source: source } : {}) }) as any[];

  return rows.map((r) => ({ ...r, metadata: JSON.parse(r.metadata) }));
}

export async function getItemsBySource(source: string, limit = 100, offset = 0): Promise<Array<DbItem & { id: number }>> {
  const rows = await getDb()
    .selectFrom("items")
    .where("source", "=", source)
    .orderBy("created_at", "desc")
    .limit(limit)
    .offset(offset)
    .selectAll()
    .execute();

  return rows.map((r) => ({ ...r, metadata: JSON.parse(r.metadata) }));
}

export async function getItemCount(): Promise<Record<string, number>> {
  const rows = await getDb()
    .selectFrom("items")
    .select(["source", sql<number>`COUNT(*)`.as("count")])
    .groupBy("source")
    .execute();

  const result: Record<string, number> = {};
  for (const row of rows) result[row.source] = row.count;
  return result;
}
