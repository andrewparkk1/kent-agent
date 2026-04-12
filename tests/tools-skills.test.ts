import { FAKE_USER_SKILLS_DIR as USER_SKILLS_DIR } from "./_tools-test-setup.ts";
import { test, expect, describe, beforeEach, afterAll } from "bun:test";
import { rmSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";

const { getSkill, createSkill, updateSkill, deleteSkill, skillTools } =
  await import("@agent/tools/skills.ts");

function cleanUserSkills() {
  try { rmSync(USER_SKILLS_DIR, { recursive: true, force: true }); } catch {}
  mkdirSync(USER_SKILLS_DIR, { recursive: true });
}

afterAll(() => {
  // cleanup is best-effort; the tmpdir will be cleared by the OS otherwise
  try { rmSync(USER_SKILLS_DIR, { recursive: true, force: true }); } catch {}
});

describe("tools/skills — schemas", () => {
  test("skillTools has 4 tools with valid schemas", () => {
    expect(skillTools.length).toBe(4);
    for (const t of skillTools) {
      expect(typeof t.name).toBe("string");
      expect(typeof t.description).toBe("string");
      expect(t.description.length).toBeGreaterThan(0);
      expect((t.parameters as any).type).toBe("object");
      expect(typeof t.execute).toBe("function");
    }
  });

  test("tool names are unique and expected", () => {
    const names = skillTools.map((t) => t.name);
    expect(names).toEqual(["get_skill", "create_skill", "update_skill", "delete_skill"]);
    expect(new Set(names).size).toBe(names.length);
  });
});

describe("tools/skills — get_skill", () => {
  beforeEach(cleanUserSkills);

  test("with no name, lists available skills", async () => {
    mkdirSync(join(USER_SKILLS_DIR, "alpha"));
    writeFileSync(join(USER_SKILLS_DIR, "alpha", "SKILL.md"), "# alpha");
    writeFileSync(join(USER_SKILLS_DIR, "beta.md"), "# beta");

    const res = await getSkill.execute("id", {});
    expect(res.content[0]!.text).toContain("Available skills:");
    expect(res.content[0]!.text).toContain("alpha");
    expect(res.content[0]!.text).toContain("beta");
  });

  test("loads nested SKILL.md content", async () => {
    mkdirSync(join(USER_SKILLS_DIR, "gamma"));
    writeFileSync(join(USER_SKILLS_DIR, "gamma", "SKILL.md"), "# gamma content");
    const res = await getSkill.execute("id", { name: "gamma" });
    expect(res.content[0]!.text).toBe("# gamma content");
  });

  test("loads flat .md content", async () => {
    writeFileSync(join(USER_SKILLS_DIR, "flat.md"), "flat body");
    const res = await getSkill.execute("id", { name: "flat" });
    expect(res.content[0]!.text).toBe("flat body");
  });

  test("missing skill throws not-found error", async () => {
    await expect(getSkill.execute("id", { name: "ghost" })).rejects.toThrow(/Skill "ghost" not found/);
  });
});

describe("tools/skills — create_skill", () => {
  beforeEach(cleanUserSkills);

  test("creates new skill at nested path", async () => {
    const res = await createSkill.execute("id", { name: "new-skill", content: "# content" });
    expect(res.content[0]!.text).toContain('Created skill "new-skill"');
    expect(existsSync(join(USER_SKILLS_DIR, "new-skill", "SKILL.md"))).toBe(true);
  });

  test("errors if skill dir already exists", async () => {
    mkdirSync(join(USER_SKILLS_DIR, "dup"));
    await expect(createSkill.execute("id", { name: "dup", content: "x" }))
      .rejects.toThrow(/already exists/);
  });
});

describe("tools/skills — update_skill", () => {
  beforeEach(cleanUserSkills);

  test("updates existing nested skill", async () => {
    mkdirSync(join(USER_SKILLS_DIR, "s1"));
    writeFileSync(join(USER_SKILLS_DIR, "s1", "SKILL.md"), "old");
    const res = await updateSkill.execute("id", { name: "s1", content: "new" });
    expect(res.content[0]!.text).toContain('Updated skill "s1"');
    const contents = await Bun.file(join(USER_SKILLS_DIR, "s1", "SKILL.md")).text();
    expect(contents).toBe("new");
  });

  test("promotes a flat .md skill to nested on update", async () => {
    writeFileSync(join(USER_SKILLS_DIR, "flat.md"), "old");
    const res = await updateSkill.execute("id", { name: "flat", content: "new body" });
    expect(res.content[0]!.text).toContain("Updated");
    // New nested file exists with the new content
    expect(existsSync(join(USER_SKILLS_DIR, "flat", "SKILL.md"))).toBe(true);
    const contents = await Bun.file(join(USER_SKILLS_DIR, "flat", "SKILL.md")).text();
    expect(contents).toBe("new body");
  });

  test("errors when skill does not exist", async () => {
    await expect(updateSkill.execute("id", { name: "ghost", content: "x" }))
      .rejects.toThrow(/not found/);
  });
});

describe("tools/skills — delete_skill", () => {
  beforeEach(cleanUserSkills);

  test("deletes a nested skill", async () => {
    mkdirSync(join(USER_SKILLS_DIR, "kill-me"));
    writeFileSync(join(USER_SKILLS_DIR, "kill-me", "SKILL.md"), "x");
    const res = await deleteSkill.execute("id", { name: "kill-me" });
    expect(res.content[0]!.text).toContain('Deleted skill "kill-me"');
    expect(existsSync(join(USER_SKILLS_DIR, "kill-me"))).toBe(false);
  });

  test("deletes a flat .md skill", async () => {
    writeFileSync(join(USER_SKILLS_DIR, "flat.md"), "x");
    const res = await deleteSkill.execute("id", { name: "flat" });
    expect(res.content[0]!.text).toContain('Deleted skill "flat"');
    expect(existsSync(join(USER_SKILLS_DIR, "flat.md"))).toBe(false);
  });

  test("errors when skill not found", async () => {
    await expect(deleteSkill.execute("id", { name: "ghost" }))
      .rejects.toThrow(/not found/);
  });
});
