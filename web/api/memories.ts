/** GET /api/memories — list/search memories. */
import { listMemories, searchMemories } from "../../shared/db.ts";

export function handleMemories(req: Request) {
  const url = new URL(req.url);
  const q = url.searchParams.get("q");
  const type = url.searchParams.get("type");

  let memories;
  if (q) {
    memories = searchMemories(q);
  } else {
    memories = listMemories({ type: type as any || undefined });
  }

  return Response.json({
    memories: memories.map((m: any) => ({
      ...m,
      sources: JSON.parse(m.sources),
      aliases: JSON.parse(m.aliases),
      is_archived: !!m.is_archived,
    })),
  });
}
