/** GET /api/items — list/search synced items across all sources. */
import { getItemCount, searchItems, getItemsBySource, getRawDb } from "../../shared/db.ts";

export async function handleCounts() {
  return Response.json(await getItemCount());
}

export async function handleItems(req: Request) {
  const url = new URL(req.url);
  const source = url.searchParams.get("source");
  const q = url.searchParams.get("q");
  const limit = Math.min(Number(url.searchParams.get("limit") || 200), 500);

  let items;
  if (q) {
    items = searchItems(q, limit, source ?? undefined);
  } else if (source) {
    items = await getItemsBySource(source, limit);
  } else {
    const rows = getRawDb()
      .prepare(`
        SELECT id, source, external_id, content, metadata, created_at
        FROM items ORDER BY created_at DESC LIMIT ?
      `)
      .all(limit) as any[];

    items = rows.map((r: any) => ({ ...r, metadata: JSON.parse(r.metadata) }));
  }

  return Response.json({ items });
}
