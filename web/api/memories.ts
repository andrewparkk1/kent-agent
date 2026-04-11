/** GET /api/memories — list/search memories. GET /api/memories/:id — single memory with links + index for resolving inline [[Title]] references. */
import { listMemories, searchMemories, getMemory, getAllLinks } from "../../shared/db.ts";

function parseMemory(m: any) {
  return {
    ...m,
    sources: JSON.parse(m.sources),
    aliases: JSON.parse(m.aliases),
    is_archived: !!m.is_archived,
  };
}

/** Build a lightweight index of title/alias → memory ID for resolving [[Title]] links. */
async function buildMemoryIndex(): Promise<Record<string, { id: string; type: string; title: string }>> {
  const all = await listMemories();
  const index: Record<string, { id: string; type: string; title: string }> = {};
  for (const m of all) {
    // Index by title (case-insensitive key)
    index[m.title.toLowerCase()] = { id: m.id, type: m.type, title: m.title };
    // Also index by each alias
    const aliases: string[] = JSON.parse(m.aliases);
    for (const alias of aliases) {
      index[alias.toLowerCase()] = { id: m.id, type: m.type, title: m.title };
    }
  }
  return index;
}

export async function handleMemoryIndex(_req: Request) {
  const index = await buildMemoryIndex();
  return Response.json({ memoryIndex: index });
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

  const [links, memoryIndex] = await Promise.all([
    getAllLinks(id),
    buildMemoryIndex(),
  ]);

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
    // Lightweight index for resolving [[Title]] inline links
    memoryIndex,
  });
}
