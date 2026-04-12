/**
 * Shared setup for tool tests — redirects homedir() to an isolated tmpdir
 * so tests that transitively load agent/tools/skills.ts don't touch the
 * real ~/.kent directory. Import this at the TOP of any test file that
 * loads skills.ts (directly or via the tools index).
 *
 * Uses a stable tmpdir keyed by the process id so multiple test files in
 * the same Bun process share the same fake home.
 */
import { mkdtempSync, mkdirSync } from "node:fs";
import * as realOs from "node:os";
import { join } from "node:path";
import { mock } from "bun:test";

// @ts-ignore — stash on globalThis so re-imports find the same value
const g = globalThis as any;
if (!g.__KENT_FAKE_HOME__) {
  g.__KENT_FAKE_HOME__ = mkdtempSync(join(realOs.tmpdir(), "kent-home-"));
  mkdirSync(join(g.__KENT_FAKE_HOME__, ".kent", "prompts", "skills"), { recursive: true });
}
if (!g.__KENT_FAKE_OUTPUT_DIR__) {
  g.__KENT_FAKE_OUTPUT_DIR__ = mkdtempSync(join(realOs.tmpdir(), "kent-out-"));
  // Set BEFORE any import of agent/tools/helpers.ts — helpers caches OUTPUT_DIR at module load.
  process.env.OUTPUT_DIR = g.__KENT_FAKE_OUTPUT_DIR__;
}

export const FAKE_HOME: string = g.__KENT_FAKE_HOME__;
export const FAKE_USER_SKILLS_DIR: string = join(FAKE_HOME, ".kent", "prompts", "skills");
export const FAKE_OUTPUT_DIR: string = g.__KENT_FAKE_OUTPUT_DIR__;

mock.module("node:os", () => ({
  ...realOs,
  homedir: () => FAKE_HOME,
  default: { ...realOs, homedir: () => FAKE_HOME },
}));
