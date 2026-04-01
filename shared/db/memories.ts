/** Memories — persistent knowledge base for the agent. */
import { sql } from "kysely";
import { getDb } from "./connection.ts";
import type { Memory, MemoryType } from "./schema.ts";

export type { Memory, MemoryType };

export async function createMemory(opts: {
  type: MemoryType;
  title: string;
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
      body: opts.body,
      sources: JSON.stringify(opts.sources ?? []),
      aliases: JSON.stringify(opts.aliases ?? []),
    })
    .execute();
  return id;
}

export async function updateMemory(
  id: string,
  fields: Partial<Pick<Memory, "title" | "body" | "type" | "is_archived"> & { sources: string[]; aliases: string[] }>,
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
