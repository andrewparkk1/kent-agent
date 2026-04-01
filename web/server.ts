import { getItemCount, searchItems, getItemsBySource, getDb } from "../shared/db.ts";

Bun.serve({
  port: 3456,
  routes: {
    "/api/counts": () => {
      return Response.json(getItemCount());
    },

    "/api/items": (req) => {
      const url = new URL(req.url);
      const source = url.searchParams.get("source");
      const q = url.searchParams.get("q");
      const limit = Math.min(Number(url.searchParams.get("limit") || 200), 500);

      let items;
      if (q) {
        items = searchItems(q, limit, source ?? undefined);
      } else if (source) {
        items = getItemsBySource(source, limit);
      } else {
        const rows = getDb()
          .prepare(`
            SELECT id, source, external_id, content, metadata, created_at
            FROM items
            ORDER BY created_at DESC
            LIMIT ?
          `)
          .all(limit) as any[];

        items = rows.map((r: any) => ({
          ...r,
          metadata: JSON.parse(r.metadata),
        }));
      }

      return Response.json({ items });
    },
  },

  fetch() {
    return new Response("Not Found", { status: 404 });
  },
});

console.log("Kent API server running at http://localhost:3456");
