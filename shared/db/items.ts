/** Items — synced data from all sources with FTS5 full-text search. */
import { getDb } from "./connection.ts";

export interface DbItem {
  source: string;
  external_id: string;
  content: string;
  metadata: Record<string, any>;
  created_at: number;
}

const _upsertItem = () => getDb().prepare(`
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

let upsertStmt: ReturnType<typeof _upsertItem> | null = null;

export function upsertItems(items: DbItem[]): number {
  const db = getDb();
  if (!upsertStmt) upsertStmt = _upsertItem();

  let count = 0;
  const tx = db.transaction(() => {
    for (const item of items) {
      upsertStmt!.run({
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

export function searchItems(query: string, limit = 50, source?: string): Array<DbItem & { id: number; rank: number }> {
  const sanitized = query.replace(/['"()*:^~]/g, " ").trim();
  if (!sanitized) return [];

  const ftsQuery = sanitized
    .split(/\s+/)
    .map((word) => `"${word}"*`)
    .join(" ");

  const sourceFilter = source ? "AND i.source = $source" : "";

  const rows = getDb()
    .prepare(`
      SELECT i.id, i.source, i.external_id, i.content, i.metadata, i.created_at, f.rank
      FROM items_fts f
      JOIN items i ON i.id = f.rowid
      WHERE items_fts MATCH $query ${sourceFilter}
      ORDER BY f.rank
      LIMIT $limit
    `)
    .all({ $query: ftsQuery, $limit: limit, ...(source ? { $source: source } : {}) }) as any[];

  return rows.map((r) => ({
    ...r,
    metadata: JSON.parse(r.metadata),
  }));
}

export function getItemsBySource(source: string, limit = 100): Array<DbItem & { id: number }> {
  const rows = getDb()
    .prepare(`
      SELECT id, source, external_id, content, metadata, created_at
      FROM items
      WHERE source = $source
      ORDER BY created_at DESC
      LIMIT $limit
    `)
    .all({ $source: source, $limit: limit }) as any[];

  return rows.map((r) => ({
    ...r,
    metadata: JSON.parse(r.metadata),
  }));
}

export function getItemCount(): Record<string, number> {
  const rows = getDb()
    .prepare("SELECT source, COUNT(*) as count FROM items GROUP BY source")
    .all() as Array<{ source: string; count: number }>;

  const result: Record<string, number> = {};
  for (const row of rows) {
    result[row.source] = row.count;
  }
  return result;
}
