/** Skill tools — load skill references on demand instead of bloating the system prompt. */
import { Type } from "@sinclair/typebox";
import type { AgentTool } from "@mariozechner/pi-agent-core";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { ok, err } from "./helpers.ts";

const USER_SKILLS_DIR = join(homedir(), ".kent", "prompts", "skills");
const BUNDLED_SKILLS_DIR = join(
  import.meta.dir, "..", "prompts", "skills"
);

function getAvailableSkills(): string[] {
  const skills = new Set<string>();
  for (const dir of [USER_SKILLS_DIR, BUNDLED_SKILLS_DIR]) {
    try {
      for (const entry of readdirSync(dir)) {
        const entryPath = join(dir, entry);
        if (statSync(entryPath).isDirectory()) {
          if (existsSync(join(entryPath, "SKILL.md"))) {
            skills.add(entry);
          }
        } else if (entry.endsWith(".md")) {
          skills.add(entry.replace(/\.md$/, ""));
        }
      }
    } catch {}
  }
  return [...skills].sort();
}

function readSkill(name: string): string | null {
  // Check user dir first (nested then flat)
  const userNested = join(USER_SKILLS_DIR, name, "SKILL.md");
  if (existsSync(userNested)) {
    try { return readFileSync(userNested, "utf-8"); } catch {}
  }
  const userFlat = join(USER_SKILLS_DIR, `${name}.md`);
  if (existsSync(userFlat)) {
    try { return readFileSync(userFlat, "utf-8"); } catch {}
  }
  // Then bundled
  const bundledNested = join(BUNDLED_SKILLS_DIR, name, "SKILL.md");
  if (existsSync(bundledNested)) {
    try { return readFileSync(bundledNested, "utf-8"); } catch {}
  }
  const bundledFlat = join(BUNDLED_SKILLS_DIR, `${name}.md`);
  if (existsSync(bundledFlat)) {
    try { return readFileSync(bundledFlat, "utf-8"); } catch {}
  }
  return null;
}

export const getSkill: AgentTool<any> = {
  name: "get_skill",
  label: "Loading skill reference...",
  description:
    "Load a skill reference by name. Skills contain CLI syntax and usage guides for external tools (e.g. 'calendar', 'gmail', 'github'). " +
    "ALWAYS call this before using gws or gh CLI commands to get the correct syntax. " +
    "Call with no arguments to list available skills.",
  parameters: Type.Object({
    name: Type.Optional(Type.String({ description: "Skill name (e.g. 'calendar', 'gmail', 'github'). Omit to list all available skills." })),
  }),
  execute: async (_id, params) => {
    if (!params.name) {
      const skills = getAvailableSkills();
      return ok(`Available skills: ${skills.join(", ")}\n\nUse get_skill with a name to load the full reference.`);
    }
    const content = readSkill(params.name);
    if (!content) {
      const available = getAvailableSkills();
      return err(`Skill "${params.name}" not found. Available: ${available.join(", ")}`);
    }
    return ok(content);
  },
};

export const skillTools = [getSkill] as AgentTool[];
