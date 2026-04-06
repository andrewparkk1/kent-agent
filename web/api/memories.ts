/** GET /api/memories — list/search memories. GET /api/memories/:id — single memory with links. */
import { listMemories, searchMemories, getMemory, getAllLinks } from "../../shared/db.ts";

function parseMemory(m: any) {
  return {
    ...m,
    sources: JSON.parse(m.sources),
    aliases: JSON.parse(m.aliases),
    is_archived: !!m.is_archived,
  };
}

export async function handleMemories(req: Request) {
  const url = new URL(req.url);
  const q = url.searchParams.get("q");
  const type = url.searchParams.get("type");

  let memories;
  if (q) {
    memories = await searchMemories(q);
  } else {
    memories = await listMemories({ type: type as any || undefined });
  }

  return Response.json({
    memories: memories.map(parseMemory),
  });
}

export async function handleMemoryDetail(req: Request) {
  const url = new URL(req.url);
  const match = url.pathname.match(/^\/api\/memories\/(.+)$/);
  if (!match) return new Response("Not Found", { status: 404 });

  const id = match[1]!;
  const memory = await getMemory(id);
  if (!memory) return new Response("Not Found", { status: 404 });

  const links = await getAllLinks(id);

  return Response.json({
    memory: parseMemory(memory),
    links: {
      outgoing: links.outgoing.map((m) => ({
        id: m.id,
        type: m.type,
        title: m.title,
        summary: m.summary,
        link_label: m.link_label,
      })),
      incoming: links.incoming.map((m) => ({
        id: m.id,
        type: m.type,
        title: m.title,
        summary: m.summary,
        link_label: m.link_label,
      })),
    },
  });
}
