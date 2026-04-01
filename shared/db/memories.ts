/** Memories — persistent knowledge base for the agent. */
import { getDb } from "./connection.ts";

export type MemoryType = "person" | "project" | "topic" | "event" | "preference" | "place";

export interface DbMemory {
  id: string;
  type: MemoryType;
  title: string;
  body: string;
  sources: string;
  aliases: string;
  is_archived: number;
  created_at: number;
  updated_at: number;
}

export function createMemory(opts: {
  type: MemoryType;
  title: string;
  body: string;
  sources?: string[];
  aliases?: string[];
}): string {
  const id = crypto.randomUUID();
  getDb()
    .prepare(`
      INSERT INTO memories (id, type, title, body, sources, aliases)
      VALUES ($id, $type, $title, $body, $sources, $aliases)
    `)
    .run({
      $id: id,
      $type: opts.type,
      $title: opts.title,
      $body: opts.body,
      $sources: JSON.stringify(opts.sources ?? []),
      $aliases: JSON.stringify(opts.aliases ?? []),
    });
  return id;
}

export function updateMemory(
  id: string,
  fields: Partial<Pick<DbMemory, "title" | "body" | "type" | "is_archived"> & { sources: string[]; aliases: string[] }>,
): void {
  const sets: string[] = [];
  const params: Record<string, any> = { $id: id };

  for (const [key, value] of Object.entries(fields)) {
    if (key === "sources" || key === "aliases") {
      sets.push(`${key} = $${key}`);
      params[`$${key}`] = JSON.stringify(value);
    } else {
      sets.push(`${key} = $${key}`);
      params[`$${key}`] = value;
    }
  }
  sets.push("updated_at = unixepoch()");

  if (sets.length === 1) return;

  getDb()
    .prepare(`UPDATE memories SET ${sets.join(", ")} WHERE id = $id`)
    .run(params);
}

export function archiveMemory(id: string): void {
  getDb()
    .prepare("UPDATE memories SET is_archived = 1, updated_at = unixepoch() WHERE id = $id")
    .run({ $id: id });
}

export function getMemory(id: string): DbMemory | null {
  return getDb()
    .prepare("SELECT * FROM memories WHERE id = $id")
    .get({ $id: id }) as DbMemory | null;
}

export function listMemories(opts?: { type?: MemoryType; includeArchived?: boolean }): DbMemory[] {
  const conditions: string[] = [];
  const params: Record<string, any> = {};

  if (!opts?.includeArchived) {
    conditions.push("is_archived = 0");
  }
  if (opts?.type) {
    conditions.push("type = $type");
    params.$type = opts.type;
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  return getDb()
    .prepare(`SELECT * FROM memories ${where} ORDER BY updated_at DESC`)
    .all(params) as DbMemory[];
}

export function searchMemories(query: string): DbMemory[] {
  const pattern = `%${query}%`;
  return getDb()
    .prepare(`
      SELECT * FROM memories
      WHERE is_archived = 0 AND (title LIKE $q OR body LIKE $q OR aliases LIKE $q)
      ORDER BY updated_at DESC
      LIMIT 50
    `)
    .all({ $q: pattern }) as DbMemory[];
}

export function deleteMemory(id: string): boolean {
  const result = getDb()
    .prepare("DELETE FROM memories WHERE id = $id")
    .run({ $id: id });
  return result.changes > 0;
}
