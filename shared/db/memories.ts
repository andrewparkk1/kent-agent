/** Memories — persistent wiki-style knowledge base for the agent. */
import { sql } from "kysely";
import { getDb } from "./connection.ts";
import type { Memory, MemoryType, MemoryLink } from "./schema.ts";

export type { Memory, MemoryType, MemoryLink };

// ─── Memory CRUD ───────────────────────────────────────────────────────────

export async function createMemory(opts: {
  type: MemoryType;
  title: string;
  summary?: string;
  body: string;
  sources?: string[];
  aliases?: string[];
}): Promise<string> {
  const id = crypto.randomUUID();
  await getDb()
    .insertInto("memories")
    .values({
      id,
      type: opts.type,
      title: opts.title,
      summary: opts.summary ?? "",
      body: opts.body,
      sources: JSON.stringify(opts.sources ?? []),
      aliases: JSON.stringify(opts.aliases ?? []),
    })
    .execute();
  return id;
}

export async function updateMemory(
  id: string,
  fields: Partial<Pick<Memory, "title" | "summary" | "body" | "type" | "is_archived"> & { sources: string[]; aliases: string[] }>,
): Promise<void> {
  const update: Record<string, any> = { updated_at: sql`unixepoch()` };
  for (const [key, value] of Object.entries(fields)) {
    update[key] = (key === "sources" || key === "aliases") ? JSON.stringify(value) : value;
  }
  await getDb().updateTable("memories").set(update).where("id", "=", id).execute();
}

export async function archiveMemory(id: string): Promise<void> {
  await getDb()
    .updateTable("memories")
    .set({ is_archived: 1, updated_at: sql`unixepoch()` })
    .where("id", "=", id)
    .execute();
}

export async function getMemory(id: string): Promise<Memory | undefined> {
  return getDb().selectFrom("memories").where("id", "=", id).selectAll().executeTakeFirst();
}

export async function listMemories(opts?: { type?: MemoryType; includeArchived?: boolean }): Promise<Memory[]> {
  let query = getDb().selectFrom("memories").orderBy("updated_at", "desc").selectAll();
  if (!opts?.includeArchived) query = query.where("is_archived", "=", 0);
  if (opts?.type) query = query.where("type", "=", opts.type);
  return query.execute();
}

export async function searchMemories(query: string): Promise<Memory[]> {
  const pattern = `%${query}%`;
  return getDb()
    .selectFrom("memories")
    .where("is_archived", "=", 0)
    .where((eb) => eb.or([
      eb("title", "like", pattern),
      eb("summary", "like", pattern),
      eb("body", "like", pattern),
      eb("aliases", "like", pattern),
    ]))
    .orderBy("updated_at", "desc")
    .limit(50)
    .selectAll()
    .execute();
}

export async function deleteMemory(id: string): Promise<boolean> {
  const result = await getDb().deleteFrom("memories").where("id", "=", id).execute();
  return result.length > 0 && Number(result[0]?.numDeletedRows) > 0;
}

// ─── Memory Links ──────────────────────────────────────────────────────────

export async function linkMemories(fromId: string, toId: string, label = ""): Promise<void> {
  await getDb()
    .insertInto("memory_links")
    .values({ from_id: fromId, to_id: toId, label })
    .onConflict((oc) => oc.columns(["from_id", "to_id"]).doUpdateSet({ label }))
    .execute();
}

export async function unlinkMemories(fromId: string, toId: string): Promise<void> {
  await getDb()
    .deleteFrom("memory_links")
    .where("from_id", "=", fromId)
    .where("to_id", "=", toId)
    .execute();
}

/** Get all memories linked FROM this memory (outgoing links). */
export async function getLinkedMemories(id: string): Promise<(Memory & { link_label: string })[]> {
  const rows = await getDb()
    .selectFrom("memory_links")
    .innerJoin("memories", "memories.id", "memory_links.to_id")
    .where("memory_links.from_id", "=", id)
    .where("memories.is_archived", "=", 0)
    .select([
      "memories.id", "memories.type", "memories.title", "memories.summary",
      "memories.body", "memories.sources", "memories.aliases",
      "memories.is_archived", "memories.created_at", "memories.updated_at",
      "memory_links.label as link_label",
    ])
    .orderBy("memories.title")
    .execute();
  return rows as any;
}

/** Get all memories that link TO this memory (backlinks). */
export async function getBacklinks(id: string): Promise<(Memory & { link_label: string })[]> {
  const rows = await getDb()
    .selectFrom("memory_links")
    .innerJoin("memories", "memories.id", "memory_links.from_id")
    .where("memory_links.to_id", "=", id)
    .where("memories.is_archived", "=", 0)
    .select([
      "memories.id", "memories.type", "memories.title", "memories.summary",
      "memories.body", "memories.sources", "memories.aliases",
      "memories.is_archived", "memories.created_at", "memories.updated_at",
      "memory_links.label as link_label",
    ])
    .orderBy("memories.title")
    .execute();
  return rows as any;
}

/** Get all links for a memory (both directions). */
export async function getAllLinks(id: string): Promise<{ outgoing: (Memory & { link_label: string })[]; incoming: (Memory & { link_label: string })[] }> {
  const [outgoing, incoming] = await Promise.all([
    getLinkedMemories(id),
    getBacklinks(id),
  ]);
  return { outgoing, incoming };
}
