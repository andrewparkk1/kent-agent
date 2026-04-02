/** Skill tools — create, read, update, delete agent skills. */
import { Type } from "@sinclair/typebox";
import type { AgentTool } from "@mariozechner/pi-agent-core";
import { existsSync, readFileSync, readdirSync, statSync, mkdirSync, rmSync } from "node:fs";
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
    "Load once per conversation — no need to reload if you already have it. " +
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

export const createSkill: AgentTool<any> = {
  name: "create_skill",
  label: "Creating skill...",
  description:
    "Create a new skill. Skills are markdown reference docs that teach you how to use a tool, API, or workflow. " +
    "They are listed in your system prompt by name — you can load them on demand with get_skill.",
  parameters: Type.Object({
    name: Type.String({ description: "Skill name (lowercase, hyphens ok, e.g. 'google-calendar')" }),
    content: Type.String({ description: "Skill content as markdown" }),
  }),
  execute: async (_id, params) => {
    try {
      const skillDir = join(USER_SKILLS_DIR, params.name);
      if (existsSync(skillDir)) return err(`Skill "${params.name}" already exists. Use update_skill to modify it.`);
      mkdirSync(skillDir, { recursive: true });
      const skillPath = join(skillDir, "SKILL.md");
      await Bun.write(skillPath, params.content);
      return ok(`Created skill "${params.name}" at ${skillPath} (${params.content.length} bytes)`);
    } catch (e) { return err(`Failed to create skill: ${e}`); }
  },
};

export const updateSkill: AgentTool<any> = {
  name: "update_skill",
  label: "Updating skill...",
  description: "Update an existing skill's content.",
  parameters: Type.Object({
    name: Type.String({ description: "Skill name to update" }),
    content: Type.String({ description: "New skill content as markdown" }),
  }),
  execute: async (_id, params) => {
    try {
      const skillPath = join(USER_SKILLS_DIR, params.name, "SKILL.md");
      const flatPath = join(USER_SKILLS_DIR, `${params.name}.md`);
      if (!existsSync(skillPath) && !existsSync(flatPath)) {
        return err(`Skill "${params.name}" not found. Use create_skill first.`);
      }
      // Always write to nested format
      if (!existsSync(join(USER_SKILLS_DIR, params.name))) {
        mkdirSync(join(USER_SKILLS_DIR, params.name), { recursive: true });
      }
      await Bun.write(join(USER_SKILLS_DIR, params.name, "SKILL.md"), params.content);
      return ok(`Updated skill "${params.name}" (${params.content.length} bytes)`);
    } catch (e) { return err(`Failed to update skill: ${e}`); }
  },
};

export const deleteSkill: AgentTool<any> = {
  name: "delete_skill",
  label: "Deleting skill...",
  description: "Delete a user skill by name. Cannot delete bundled skills.",
  parameters: Type.Object({
    name: Type.String({ description: "Skill name to delete" }),
  }),
  execute: async (_id, params) => {
    try {
      const skillDir = join(USER_SKILLS_DIR, params.name);
      const flatPath = join(USER_SKILLS_DIR, `${params.name}.md`);
      if (existsSync(skillDir)) {
        rmSync(skillDir, { recursive: true });
        return ok(`Deleted skill "${params.name}"`);
      }
      if (existsSync(flatPath)) {
        rmSync(flatPath);
        return ok(`Deleted skill "${params.name}"`);
      }
      return err(`Skill "${params.name}" not found in user skills.`);
    } catch (e) { return err(`Failed to delete skill: ${e}`); }
  },
};

export const skillTools = [getSkill, createSkill, updateSkill, deleteSkill] as AgentTool[];
