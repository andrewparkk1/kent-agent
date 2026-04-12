/**
 * AI Coding source — reads local conversation history from Claude Code and Codex.
 *
 * Claude Code stores per-project session JSONL at:
 *   ~/.claude/projects/<project-slug>/<session-id>.jsonl
 *
 * Codex stores:
 *   ~/.codex/history.jsonl — flat list of every prompt (session_id + ts + text)
 *   ~/.codex/archived_sessions/*.jsonl — full session conversations
 *
 * We ingest prompts (what you asked) and optionally assistant responses
 * (truncated). Tool calls are skipped to keep volume manageable.
 */
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import type { Source, SyncState, SyncOptions, Item } from "./types";

const DEFAULT_CLAUDE_PROJECTS = join(homedir(), ".claude", "projects");
const DEFAULT_CODEX_DIR = join(homedir(), ".codex");

/** Max chars of assistant response to store (keeps DB size in check). */
const MAX_RESPONSE_LEN = 1500;

/** Decode Claude Code project slug back to a readable name.
 *  Slugs are hyphenated absolute paths — extract the last segment. */
function decodeProjectSlug(slug: string): string {
  const decoded = slug.replace(/^-/, "").replace(/-/g, "/");
  return decoded.split("/").pop() || slug;
}

// ── Claude Code ──────────────────────────────────────────────────────────────

async function ingestClaudeCode(items: Item[], lastSync: number, CLAUDE_PROJECTS: string): Promise<void> {
  let projectDirs: string[];
  try {
    projectDirs = readdirSync(CLAUDE_PROJECTS, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);
  } catch {
    return; // ~/.claude/projects doesn't exist
  }

  for (const dirName of projectDirs) {
    const projectPath = join(CLAUDE_PROJECTS, dirName);
    let files: string[];
    try {
      files = readdirSync(projectPath).filter((f) => f.endsWith(".jsonl"));
    } catch {
      continue;
    }

    for (const file of files) {
      const filePath = join(projectPath, file);

      // Skip files not modified since last sync
      try {
        const stat = statSync(filePath);
        if (stat.mtimeMs / 1000 < lastSync) continue;
      } catch {
        continue;
      }

      let content: string;
      try {
        content = await Bun.file(filePath).text();
      } catch {
        continue;
      }

      for (const line of content.split("\n")) {
        if (!line.trim()) continue;
        try {
          const entry = JSON.parse(line);
          const ts = entry.timestamp
            ? new Date(entry.timestamp).getTime() / 1000
            : 0;
          if (ts <= lastSync || ts <= 0) continue;

          if (entry.type === "user") {
            const text =
              typeof entry.message?.content === "string"
                ? entry.message.content
                : null;
            if (!text || text.length < 3) continue;

            items.push({
              source: "ai_coding",
              externalId: `claude:${entry.uuid}`,
              content: `[Claude Code Query] ${text}`,
              metadata: {
                tool: "claude_code",
                type: "prompt",
                project: dirName,
                sessionId: entry.sessionId,
                sessionName: decodeProjectSlug(dirName),
                branch: entry.gitBranch,
                cwd: entry.cwd,
              },
              createdAt: ts,
            });
          }

          if (entry.type === "assistant") {
            const msg = entry.message;
            let text: string | null = null;
            if (typeof msg?.content === "string") {
              text = msg.content;
            } else if (Array.isArray(msg?.content)) {
              text = msg.content
                .filter((b: any) => b.type === "text")
                .map((b: any) => b.text)
                .join("\n");
            }
            if (!text || text.length < 10) continue;

            items.push({
              source: "ai_coding",
              externalId: `claude:${entry.uuid}`,
              content: `[Claude Code Response] ${text.substring(0, MAX_RESPONSE_LEN)}`,
              metadata: {
                tool: "claude_code",
                type: "response",
                project: dirName,
                sessionId: entry.sessionId,
                sessionName: decodeProjectSlug(dirName),
              },
              createdAt: ts,
            });
          }
        } catch {
          // malformed line — skip
        }
      }
    }
  }
}

// ── Codex ────────────────────────────────────────────────────────────────────

async function ingestCodexHistory(items: Item[], lastSync: number, CODEX_HISTORY: string): Promise<void> {
  let content: string;
  try {
    content = await Bun.file(CODEX_HISTORY).text();
  } catch {
    return; // no history file
  }

  for (const line of content.split("\n")) {
    if (!line.trim()) continue;
    try {
      const entry = JSON.parse(line);
      const ts = entry.ts;
      if (!ts || ts <= lastSync) continue;
      if (!entry.text || entry.text.length < 3) continue;

      items.push({
        source: "ai_coding",
        externalId: `codex:${entry.session_id}:${ts}`,
        content: `[Codex Query] ${entry.text}`,
        metadata: {
          tool: "codex",
          type: "prompt",
          sessionId: entry.session_id,
        },
        createdAt: ts,
      });
    } catch {
      // skip malformed
    }
  }
}

async function ingestCodexSessions(items: Item[], lastSync: number, CODEX_ARCHIVES: string): Promise<void> {
  let archiveFiles: string[];
  try {
    archiveFiles = readdirSync(CODEX_ARCHIVES).filter((f) => f.endsWith(".jsonl"));
  } catch {
    return;
  }

  for (const file of archiveFiles) {
    const filePath = join(CODEX_ARCHIVES, file);

    try {
      const stat = statSync(filePath);
      if (stat.mtimeMs / 1000 < lastSync) continue;
    } catch {
      continue;
    }

    let content: string;
    try {
      content = await Bun.file(filePath).text();
    } catch {
      continue;
    }

    let sessionMeta: any = {};

    for (const line of content.split("\n")) {
      if (!line.trim()) continue;
      try {
        const entry = JSON.parse(line);
        const ts = entry.timestamp
          ? new Date(entry.timestamp).getTime() / 1000
          : 0;

        if (entry.type === "session_meta") {
          sessionMeta = entry.payload || {};
          continue;
        }

        if (ts <= lastSync || ts <= 0) continue;

        // Assistant messages from sessions
        if (
          entry.type === "response_item" &&
          entry.payload?.role === "assistant" &&
          entry.payload?.type === "message"
        ) {
          const text = extractCodexText(entry.payload);
          if (!text || text.length < 10) continue;

          items.push({
            source: "ai_coding",
            externalId: `codex:resp:${sessionMeta.id || file}:${ts}`,
            content: `[Codex Response] ${text.substring(0, MAX_RESPONSE_LEN)}`,
            metadata: {
              tool: "codex",
              type: "response",
              sessionId: sessionMeta.id,
              sessionName: sessionMeta.cwd ? sessionMeta.cwd.split("/").pop() : undefined,
              cwd: sessionMeta.cwd,
              model: sessionMeta.model_provider,
              entrypoint: sessionMeta.source, // "vscode", "cli", etc.
            },
            createdAt: ts,
          });
        }
      } catch {
        // skip
      }
    }
  }
}

function extractCodexText(payload: any): string | null {
  if (typeof payload.content === "string") return payload.content;
  if (Array.isArray(payload.content)) {
    const text = payload.content
      .filter(
        (c: any) =>
          c.type === "input_text" ||
          c.type === "output_text" ||
          c.type === "text"
      )
      .map((c: any) => c.text)
      .join("\n");
    return text || null;
  }
  return null;
}

// ── Source export ─────────────────────────────────────────────────────────────

export interface AiCodingConfig {
  claudeDir?: string;
  codexDir?: string;
  now?: () => number;
}

export function createAiCodingSource(config: AiCodingConfig = {}): Source {
  const CLAUDE_PROJECTS = config.claudeDir ?? DEFAULT_CLAUDE_PROJECTS;
  const CODEX_DIR = config.codexDir ?? DEFAULT_CODEX_DIR;
  const CODEX_HISTORY = join(CODEX_DIR, "history.jsonl");
  const CODEX_ARCHIVES = join(CODEX_DIR, "archived_sessions");
  return {
    name: "ai_coding",

    async fetchNew(state: SyncState, _options?: SyncOptions): Promise<Item[]> {
      const lastSync = state.getLastSync("ai_coding");
      const items: Item[] = [];

      await Promise.all([
        ingestClaudeCode(items, lastSync, CLAUDE_PROJECTS),
        ingestCodexHistory(items, lastSync, CODEX_HISTORY),
        ingestCodexSessions(items, lastSync, CODEX_ARCHIVES),
      ]);

      return items;
    },
  };
}

export const aiCoding: Source = createAiCodingSource();
