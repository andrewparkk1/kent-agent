/** GET/POST /api/identity — read/write agent prompt files. */
import { PROMPTS_DIR } from "../../shared/config.ts";
import { readFileSync, existsSync, readdirSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

export function handleIdentity() {
  console.log("[identity] GET /api/identity — PROMPTS_DIR:", PROMPTS_DIR);
  console.log("[identity] exists?", existsSync(PROMPTS_DIR));
  const files: Record<string, string> = {};

  if (existsSync(PROMPTS_DIR)) {
    const entries = readdirSync(PROMPTS_DIR);
    console.log("[identity] entries:", entries);
    for (const name of entries) {
      if (name.endsWith(".md")) {
        try {
          files[name] = readFileSync(join(PROMPTS_DIR, name), "utf-8");
        } catch {}
      }
    }

    const skillsDir = join(PROMPTS_DIR, "skills");
    if (existsSync(skillsDir)) {
      for (const name of readdirSync(skillsDir)) {
        if (name.endsWith(".md")) {
          try {
            files[`skills/${name}`] = readFileSync(join(skillsDir, name), "utf-8");
          } catch {}
        }
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
