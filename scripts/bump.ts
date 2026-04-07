#!/usr/bin/env bun
/**
 * Bump version in package.json and tauri.conf.json, then commit + tag.
 * Usage: bun run scripts/bump.ts [patch|minor|major]
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "..");
const PKG_PATH = resolve(ROOT, "package.json");
const TAURI_PATH = resolve(ROOT, "web/src-tauri/tauri.conf.json");

const type = (process.argv[2] || "patch") as "patch" | "minor" | "major";

// Read current version
const pkg = JSON.parse(readFileSync(PKG_PATH, "utf-8"));
const [major, minor, patch] = pkg.version.split(".").map(Number);

let newVersion: string;
switch (type) {
  case "major": newVersion = `${major + 1}.0.0`; break;
  case "minor": newVersion = `${major}.${minor + 1}.0`; break;
  default:      newVersion = `${major}.${minor}.${patch + 1}`; break;
}

// Update package.json
pkg.version = newVersion;
writeFileSync(PKG_PATH, JSON.stringify(pkg, null, 4) + "\n", "utf-8");

// Update tauri.conf.json
const tauri = JSON.parse(readFileSync(TAURI_PATH, "utf-8"));
tauri.version = newVersion;
writeFileSync(TAURI_PATH, JSON.stringify(tauri, null, 2) + "\n", "utf-8");

console.log(`${pkg.version.replace(newVersion, '')}${type}: ${major}.${minor}.${patch} → ${newVersion}`);

// Git commit + tag
const { spawnSync } = Bun;
spawnSync(["git", "add", PKG_PATH, TAURI_PATH], { cwd: ROOT });
spawnSync(["git", "commit", "-m", newVersion], { cwd: ROOT, stdout: "inherit" });
spawnSync(["git", "tag", `v${newVersion}`], { cwd: ROOT });

console.log(`Tagged v${newVersion}`);
console.log(`Push with: git push origin main --tags`);
