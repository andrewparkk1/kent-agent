/** GET/POST /api/identity — read/write agent prompt files. */
import { PROMPTS_DIR } from "../../shared/config.ts";
import { readFileSync, existsSync, readdirSync, writeFileSync, mkdirSync, statSync } from "node:fs";
import { join } from "node:path";

export function handleIdentity() {
  const files: Record<string, string> = {};

  if (existsSync(PROMPTS_DIR)) {
    for (const name of readdirSync(PROMPTS_DIR)) {
      if (name.endsWith(".md")) {
        try {
          files[name] = readFileSync(join(PROMPTS_DIR, name), "utf-8");
        } catch {}
      }
    }

    // Load skills from nested dirs (skills/<name>/SKILL.md) with flat fallback
    const skillsDir = join(PROMPTS_DIR, "skills");
    if (existsSync(skillsDir)) {
      for (const entry of readdirSync(skillsDir)) {
        const entryPath = join(skillsDir, entry);
        try {
          if (statSync(entryPath).isDirectory()) {
            // Nested: skills/<name>/SKILL.md
            const skillFile = join(entryPath, "SKILL.md");
            if (existsSync(skillFile)) {
              files[`skills/${entry}/SKILL.md`] = readFileSync(skillFile, "utf-8");
            }
          } else if (entry.endsWith(".md")) {
            // Legacy flat: skills/<name>.md
            files[`skills/${entry}`] = readFileSync(entryPath, "utf-8");
          }
        } catch {}
      }
    }
  }

  return Response.json({ files });
}

export async function handleIdentitySave(req: Request) {
  const body = await req.json();
  const { file, content } = body as { file: string; content: string };

  if (!file || content === undefined) {
    return Response.json({ error: "file and content required" }, { status: 400 });
  }

  if (file.includes("..")) {
    return Response.json({ error: "Invalid file path" }, { status: 400 });
  }

  const fullPath = join(PROMPTS_DIR, file);
  try {
    const dir = fullPath.substring(0, fullPath.lastIndexOf("/"));
    if (dir) mkdirSync(dir, { recursive: true });
    writeFileSync(fullPath, content, "utf-8");
    return Response.json({ ok: true });
  } catch (e) {
    return Response.json({ error: String(e) }, { status: 500 });
  }
}
