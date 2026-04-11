/**
 * macOS Recent Files — tracks recently accessed/modified files via Spotlight (mdfind).
 *
 * Runs `mdfind` with a date filter against ~/Documents, ~/Desktop, and ~/Downloads
 * to find recently modified files, then stats each file for metadata.
 */
import { join, basename, extname, dirname } from "path";
import { homedir } from "os";
import type { Source, SyncState, SyncOptions, Item } from "./types";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SOURCE_NAME = "recent-files";
const MAX_FILE_SIZE = 100 * 1024 * 1024; // 100 MB
const DEFAULT_LIMIT = 500;
const DEFAULT_DAYS = 7;

/** Directories to skip (matched against any path segment). */
const NOISE_DIRS = new Set([
  ".git",
  "node_modules",
  ".cache",
  "__pycache__",
  ".Trash",
  ".npm",
  ".bun",
  ".venv",
  "venv",
  ".tox",
]);

/** Search roots under $HOME */
const SEARCH_DIRS = ["Documents", "Desktop", "Downloads"];

// ---------------------------------------------------------------------------
// File categorisation
// ---------------------------------------------------------------------------

const CATEGORY_MAP: Record<string, string> = {
  // Documents
  ".pdf": "document",
  ".doc": "document",
  ".docx": "document",
  ".xls": "document",
  ".xlsx": "document",
  ".ppt": "document",
  ".pptx": "document",
  ".txt": "document",
  ".rtf": "document",
  ".csv": "document",
  ".pages": "document",
  ".numbers": "document",
  ".keynote": "document",
  ".odt": "document",
  ".ods": "document",
  ".odp": "document",
  ".epub": "document",
  ".md": "document",

  // Code
  ".ts": "code",
  ".tsx": "code",
  ".js": "code",
  ".jsx": "code",
  ".py": "code",
  ".rb": "code",
  ".go": "code",
  ".rs": "code",
  ".java": "code",
  ".c": "code",
  ".cpp": "code",
  ".h": "code",
  ".hpp": "code",
  ".swift": "code",
  ".kt": "code",
  ".sh": "code",
  ".bash": "code",
  ".zsh": "code",
  ".css": "code",
  ".html": "code",
  ".json": "code",
  ".yaml": "code",
  ".yml": "code",
  ".toml": "code",
  ".xml": "code",
  ".sql": "code",

  // Images
  ".png": "image",
  ".jpg": "image",
  ".jpeg": "image",
  ".gif": "image",
  ".bmp": "image",
  ".svg": "image",
  ".webp": "image",
  ".heic": "image",
  ".heif": "image",
  ".tiff": "image",
  ".ico": "image",
  ".raw": "image",

  // Video
  ".mp4": "video",
  ".mov": "video",
  ".avi": "video",
  ".mkv": "video",
  ".wmv": "video",
  ".flv": "video",
  ".webm": "video",
  ".m4v": "video",

  // Audio
  ".mp3": "audio",
  ".wav": "audio",
  ".aac": "audio",
  ".flac": "audio",
  ".ogg": "audio",
  ".m4a": "audio",
  ".wma": "audio",
  ".aiff": "audio",

  // Archives
  ".zip": "archive",
  ".tar": "archive",
  ".gz": "archive",
  ".bz2": "archive",
  ".xz": "archive",
  ".rar": "archive",
  ".7z": "archive",
  ".dmg": "archive",
  ".iso": "archive",
};

function categorize(ext: string): string {
  return CATEGORY_MAP[ext.toLowerCase()] ?? "other";
}

// ---------------------------------------------------------------------------
// Path hashing (simple FNV-1a for deterministic short IDs)
// ---------------------------------------------------------------------------

function hashPath(path: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < path.length; i++) {
    hash ^= path.charCodeAt(i);
    hash = (hash * 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

// ---------------------------------------------------------------------------
// Path filtering
// ---------------------------------------------------------------------------

function isHiddenOrNoise(filePath: string): boolean {
  const segments = filePath.split("/");
  for (const segment of segments) {
    if (!segment) continue;
    // Hidden files/dirs (except the home dir itself)
    if (segment.startsWith(".") && NOISE_DIRS.has(segment)) return true;
    if (NOISE_DIRS.has(segment)) return true;
  }
  // Also skip files whose name starts with "." (hidden files)
  const name = basename(filePath);
  if (name.startsWith(".")) return true;

  return false;
}

// ---------------------------------------------------------------------------
// mdfind runner
// ---------------------------------------------------------------------------

async function runMdfind(daysBack: number): Promise<string[]> {
  const home = homedir();
  const searchDirs = SEARCH_DIRS.map((d) => join(home, d));

  // Build -onlyin flags
  const args: string[] = [];
  for (const dir of searchDirs) {
    args.push("-onlyin", dir);
  }

  // Spotlight date filter: files modified in the last N days
  args.push(`kMDItemFSContentChangeDate >= $time.today(-${Math.floor(daysBack)})`);

  const proc = Bun.spawn(["mdfind", ...args], {
    stdout: "pipe",
    stderr: "pipe",
  });

  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  await proc.exited;

  if (proc.exitCode !== 0) {
    throw new Error(`mdfind failed (exit ${proc.exitCode}): ${stderr.slice(0, 300)}`);
  }

  return stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

// ---------------------------------------------------------------------------
// Stat helper
// ---------------------------------------------------------------------------

interface FileStat {
  path: string;
  sizeBytes: number;
  mtimeMs: number;
}

async function statFile(filePath: string): Promise<FileStat | null> {
  try {
    const file = Bun.file(filePath);
    const size = file.size;
    // Bun.file doesn't expose mtime directly; use node:fs stat
    const { stat } = await import("node:fs/promises");
    const stats = await stat(filePath);
    return {
      path: filePath,
      sizeBytes: size,
      mtimeMs: stats.mtimeMs,
    };
  } catch {
    // File may have been deleted since mdfind ran
    return null;
  }
}

// ---------------------------------------------------------------------------
// Source implementation
// ---------------------------------------------------------------------------

export const recentFiles: Source = {
  name: SOURCE_NAME,

  async fetchNew(state: SyncState, options?: SyncOptions): Promise<Item[]> {
    const lastSync = state.getLastSync(SOURCE_NAME);
    const limit = options?.limit ?? DEFAULT_LIMIT;

    // Calculate how many days back to look
    const now = Date.now() / 1000;
    let daysBack: number;
    if (lastSync > 0) {
      const secondsSinceSync = now - lastSync;
      daysBack = Math.max(1, Math.ceil(secondsSinceSync / 86400) + 1);
    } else {
      daysBack = options?.defaultDays ?? DEFAULT_DAYS;
    }

    // Cap to something reasonable
    daysBack = Math.min(daysBack, 90);

    let paths: string[];
    try {
      paths = await runMdfind(daysBack);
    } catch (e) {
      console.warn(`[${SOURCE_NAME}] mdfind failed: ${e}`);
      return [];
    }

    // Filter out hidden files and noise directories
    paths = paths.filter((p) => !isHiddenOrNoise(p));

    // Cap the number of paths we process
    if (paths.length > limit) {
      paths = paths.slice(0, limit);
    }

    const items: Item[] = [];

    for (const filePath of paths) {
      const stats = await statFile(filePath);
      if (!stats) continue;

      // Skip files that are too large
      if (stats.sizeBytes > MAX_FILE_SIZE) continue;

      const filename = basename(filePath);
      const extension = extname(filePath).toLowerCase();
      const category = categorize(extension);
      const directory = dirname(filePath);
      const mtimeUnix = Math.floor(stats.mtimeMs / 1000);

      // Only include files modified after last sync
      if (lastSync > 0 && mtimeUnix <= lastSync) continue;

      items.push({
        source: SOURCE_NAME,
        externalId: `${SOURCE_NAME}-${hashPath(filePath)}`,
        content: `${filename} (${category}) \u2014 ${directory}`,
        metadata: {
          path: filePath,
          filename,
          extension: extension || undefined,
          category,
          sizeBytes: stats.sizeBytes,
          directory,
        },
        createdAt: mtimeUnix,
      });

      options?.onProgress?.(items.length);
    }

    return items;
  },
};
