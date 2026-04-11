/**
 * Obsidian — reads .md files from the user's Obsidian vault directory.
 *
 * Vault discovery order:
 * 1. OBSIDIAN_VAULT_PATH env var (explicit override)
 * 2. ~/Library/Application Support/obsidian/obsidian.json (vault config)
 * 3. ~/.obsidian (direct vault at home dir)
 */
import { readdirSync, statSync } from "fs";
import { join, relative, dirname, basename } from "path";
import { homedir } from "os";
import { existsSync } from "fs";
import type { Source, SyncState, SyncOptions, Item } from "./types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Simple string hash (djb2). Returns a hex string. */
function simpleHash(str: string): string {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash + str.charCodeAt(i)) | 0;
  }
  return (hash >>> 0).toString(16);
}

/** Parse YAML frontmatter from markdown content. Returns parsed fields or null. */
function parseFrontmatter(content: string): Record<string, any> | null {
  if (!content.startsWith("---")) return null;
  const endIdx = content.indexOf("\n---", 3);
  if (endIdx === -1) return null;

  const yaml = content.slice(4, endIdx).trim();
  const result: Record<string, any> = {};

  for (const line of yaml.split("\n")) {
    const colonIdx = line.indexOf(":");
    if (colonIdx === -1) continue;
    const key = line.slice(0, colonIdx).trim();
    let value: any = line.slice(colonIdx + 1).trim();

    if (!key) continue;

    // Handle arrays in [a, b, c] format
    if (value.startsWith("[") && value.endsWith("]")) {
      value = value
        .slice(1, -1)
        .split(",")
        .map((s: string) => s.trim().replace(/^["']|["']$/g, ""))
        .filter(Boolean);
    }
    // Handle quoted strings
    else if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    // Handle booleans
    else if (value === "true") value = true;
    else if (value === "false") value = false;
    // Handle numbers
    else if (value !== "" && !isNaN(Number(value))) value = Number(value);

    result[key] = value;
  }

  return Object.keys(result).length > 0 ? result : null;
}

// ---------------------------------------------------------------------------
// Vault discovery
// ---------------------------------------------------------------------------

/** Find the Obsidian vault path. */
function findVaultPath(): string | null {
  // 1. Env var override
  const envPath = process.env.OBSIDIAN_VAULT_PATH;
  if (envPath && existsSync(envPath)) {
    return envPath;
  }

  // 2. Obsidian config file (macOS)
  const configPath = join(homedir(), "Library/Application Support/obsidian/obsidian.json");
  if (existsSync(configPath)) {
    try {
      const config = JSON.parse(require("fs").readFileSync(configPath, "utf-8"));
      if (config.vaults && typeof config.vaults === "object") {
        for (const key of Object.keys(config.vaults)) {
          const vault = config.vaults[key];
          const vaultPath = vault?.path;
          if (vaultPath && existsSync(vaultPath)) {
            return vaultPath;
          }
        }
      }
    } catch {
      // Ignore parse errors
    }
  }

  // 3. ~/.obsidian means the home dir itself is a vault
  const homeObsidian = join(homedir(), ".obsidian");
  if (existsSync(homeObsidian)) {
    return homedir();
  }

  return null;
}

// ---------------------------------------------------------------------------
// File walker
// ---------------------------------------------------------------------------

const SKIP_DIRS = new Set([".obsidian", ".trash"]);

/** Recursively find all .md files in the vault directory. */
function walkMarkdownFiles(dir: string): string[] {
  const files: string[] = [];

  let entries: ReturnType<typeof readdirSync>;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return files;
  }

  for (const entry of entries) {
    if (entry.name.startsWith(".") && SKIP_DIRS.has(entry.name)) continue;
    // Also skip hidden directories in general
    if (entry.name.startsWith(".")) continue;

    const fullPath = join(dir, entry.name);

    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      files.push(...walkMarkdownFiles(fullPath));
    } else if (entry.isFile() && entry.name.endsWith(".md")) {
      files.push(fullPath);
    }
  }

  return files;
}

// ---------------------------------------------------------------------------
// Source implementation
// ---------------------------------------------------------------------------

export const obsidian: Source = {
  name: "obsidian",

  async fetchNew(state: SyncState, options?: SyncOptions): Promise<Item[]> {
    const vaultPath = findVaultPath();
    if (!vaultPath) {
      console.warn("[obsidian] No Obsidian vault found");
      return [];
    }

    const lastSync = state.getLastSync("obsidian");
    const now = Math.floor(Date.now() / 1000);
    const defaultDays = options?.defaultDays ?? 365;
    const cutoff =
      lastSync > 0
        ? lastSync
        : defaultDays === 0
          ? 0
          : now - defaultDays * 86400;
    const limit = options?.limit ?? 5000;

    const allFiles = walkMarkdownFiles(vaultPath);
    const items: Item[] = [];
    let count = 0;

    for (const filePath of allFiles) {
      if (items.length >= limit) break;

      let stat;
      try {
        stat = statSync(filePath);
      } catch {
        continue;
      }

      const mtimeSec = Math.floor(stat.mtimeMs / 1000);
      if (mtimeSec <= cutoff) continue;

      let content: string;
      try {
        content = await Bun.file(filePath).text();
      } catch {
        continue;
      }

      const relPath = relative(vaultPath, filePath);
      const title = basename(filePath, ".md");
      const folder = dirname(relPath) === "." ? "" : dirname(relPath);
      const externalId = `obsidian-${simpleHash(relPath)}`;

      // Parse frontmatter
      const frontmatter = parseFrontmatter(content);
      const tags: string[] = frontmatter?.tags
        ? Array.isArray(frontmatter.tags)
          ? frontmatter.tags
          : [String(frontmatter.tags)]
        : [];

      const wordCount = content.split(/\s+/).filter(Boolean).length;

      // Build the final content with title
      const fullContent = content.startsWith(`# ${title}`)
        ? content
        : `# ${title}\n\n${content}`;

      items.push({
        source: "obsidian",
        externalId,
        content: fullContent,
        metadata: {
          title,
          folder,
          tags,
          wordCount,
          ...(frontmatter || {}),
        },
        createdAt: mtimeSec,
      });

      count++;
      if (options?.onProgress && count % 50 === 0) {
        options.onProgress(count);
      }
    }

    if (options?.onProgress && count > 0) {
      options.onProgress(count);
    }

    return items;
  },
};
