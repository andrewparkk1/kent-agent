/** GET /api/items — list/search synced items across all sources. */
import { getItemCount, searchItems, getItemsBySource } from "../../shared/db.ts";
import { getDb } from "../../shared/db/connection.ts";
import { sql } from "kysely";

export async function handleCounts() {
  return Response.json(await getItemCount());
}

export async function handleItems(req: Request) {
  const url = new URL(req.url);
  const source = url.searchParams.get("source");
  const q = url.searchParams.get("q");
  const limit = Math.min(Number(url.searchParams.get("limit") || 50), 500);
  const offset = Math.max(Number(url.searchParams.get("offset") || 0), 0);

  let items;
  let total = 0;
  if (q) {
    items = searchItems(q, limit + 1, source ?? undefined);
  } else if (source) {
    items = await getItemsBySource(source, limit + 1, offset);
    const counts = await getItemCount();
    total = counts[source] || 0;
  } else {
    const rows = await getDb()
      .selectFrom("items")
      .orderBy("created_at", "desc")
      .limit(limit + 1)
      .offset(offset)
      .selectAll()
      .execute();

    items = rows.map((r) => ({ ...r, metadata: JSON.parse(r.metadata) }));

    const countResult = await getDb()
      .selectFrom("items")
      .select(sql<number>`COUNT(*)`.as("total"))
      .executeTakeFirst();
    total = countResult?.total || 0;
  }

  const hasMore = items.length > limit;
  if (hasMore) items = items.slice(0, limit);

  return Response.json({ items, hasMore, total });
}
