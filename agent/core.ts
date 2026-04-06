/**
 * Core agent logic extracted as a callable function.
 * Can be invoked in-process (no subprocess spawn needed) or from the CLI entry point.
 */
import { Agent } from "@mariozechner/pi-agent-core";
import { streamSimple, getModel } from "@mariozechner/pi-ai";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import { allTools } from "./tools/index.ts";
import { getItemCount, createThread, addMessage, getMessages, listMemories } from "@shared/db.ts";

// ─── Prompt assembly ────────────────────────────────────────────────────────

const BUNDLED_PROMPTS_DIR = join(dirname(import.meta.path), "prompts");

function getUserPromptsDir(): string {
  return join(homedir(), ".kent", "prompts");
}

function readPromptFile(name: string): string {
  const userPath = join(getUserPromptsDir(), name);
  if (existsSync(userPath)) {
    try { return readFileSync(userPath, "utf-8"); } catch {}
  }
  try {
    return readFileSync(join(BUNDLED_PROMPTS_DIR, name), "utf-8");
  } catch {
    return "";
  }
}

async function getContext(): Promise<string> {
  try {
    const counts = await getItemCount();
    if (Object.keys(counts).length === 0) {
      return "No synced data available yet. Run `kent sync` to populate.";
    }
    return `## Available Data\n${Object.entries(counts).map(([s, c]) => `- ${s}: ${c} items`).join("\n")}`;
  } catch {
    return "Could not read local database.";
  }
}

async function getMemoriesContext(): Promise<string> {
  try {
    const memories = await listMemories();
    if (memories.length === 0) return "";

    const now = Math.floor(Date.now() / 1000);
    const DAY = 86400;

    const lines = memories.map((m) => {
      const daysSinceUpdate = Math.floor((now - m.updated_at) / DAY);
      const stale = daysSinceUpdate >= 30 ? " ⚠️ STALE" : "";
      const aliases = JSON.parse(m.aliases);
      const aliasStr = aliases.length > 0 ? ` (aliases: ${aliases.join(", ")})` : "";
      const summaryStr = m.summary ? `\n  Summary: ${m.summary}` : "";
      return `- **[${m.id}]** ${m.type}: ${m.title}${aliasStr}${stale}${summaryStr}\n  ${m.body.split("\n").slice(0, 3).join(" ").slice(0, 200)}`;
    });

    return `## Known Memories (${memories.length})\n\nThese are wiki-style memory pages. Check this list before creating new ones to avoid duplicates. Update existing entries when you learn new info. Link related memories together.\n\n${lines.join("\n")}`;
  } catch {
    return "";
  }
}

export async function buildSystemPrompt(options?: {
  timezone?: string;
  conversationHistory?: string;
}): Promise<string> {
  const identity = readPromptFile("IDENTITY.md");
  const soul = readPromptFile("SOUL.md");
  const tools = readPromptFile("TOOLS.md");
  const userTemplate = readPromptFile("USER.md");

  const tz = options?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone;
  const today = new Date().toLocaleDateString("en-US", {
    weekday: "long", year: "numeric", month: "long", day: "numeric",
    timeZone: tz,
  });
  const now = new Date().toLocaleTimeString("en-US", {
    hour: "2-digit", minute: "2-digit", timeZone: tz, timeZoneName: "short",
  });

  const user = userTemplate.replace(/\{\{DATE\}\}/g, today).replace(/\{\{CONTEXT\}\}/g, await getContext());
  const identityResolved = identity
    .replace(/\{\{DATE\}\}/g, today)
    .replace(/\{\{TIME\}\}/g, now)
    .replace(/\{\{TIMEZONE\}\}/g, tz);

  // Collect skill names + paths (don't inline contents — agent can read_file on demand)
  const skillEntries: { name: string; path: string }[] = [];
  const seenSkills = new Set<string>();
  for (const skillsDir of [join(getUserPromptsDir(), "skills"), join(BUNDLED_PROMPTS_DIR, "skills")]) {
    try {
      for (const entry of readdirSync(skillsDir)) {
        if (seenSkills.has(entry)) continue;
        const entryPath = join(skillsDir, entry);
        if (statSync(entryPath).isDirectory()) {
          const skillFile = join(entryPath, "SKILL.md");
          if (existsSync(skillFile)) {
            seenSkills.add(entry);
            skillEntries.push({ name: entry, path: skillFile });
          }
        } else if (entry.endsWith(".md")) {
          const name = entry.replace(/\.md$/, "");
          seenSkills.add(name);
          skillEntries.push({ name, path: entryPath });
        }
      }
    } catch {}
  }

  const skillSection = skillEntries.length > 0
    ? `## Available Skills\n\nYou have ${skillEntries.length} skills available. Use the read_file tool to load a skill when needed.\n\n${skillEntries.map((s) => `- **${s.name}** → \`${s.path}\``).join("\n")}`
    : "";

  const memoriesSection = await getMemoriesContext();
  const parts = [identityResolved, soul, tools, skillSection, memoriesSection, user].filter(Boolean);

  if (options?.conversationHistory) {
    parts.push(`## Conversation History\n\nBelow is the prior conversation in this thread. The user's latest message (your current task) follows as the user prompt. Pay close attention to the MOST RECENT messages — if the user is correcting, cancelling, or changing a previous request, follow their latest instructions.\n\n${options.conversationHistory}`);
  }

  return parts.join("\n\n---\n\n");
}

// ─── Agent events ──────────────────────────────────────────────────────────

export interface AgentCallbacks {
  onTextDelta?: (delta: string) => void;
  onToolStart?: (name: string, args: any) => void;
  onToolEnd?: (name: string, result: string, isError: boolean) => void;
  onError?: (error: string) => void;
}

export interface RunAgentOptions {
  prompt: string;
  threadId?: string;
  modelName?: string;
  timezone?: string;
  conversationHistory?: string;
  skipUserMessage?: boolean;
  callbacks?: AgentCallbacks;
}

export interface AgentResult {
  threadId: string;
  output: string;
  hasOutput: boolean;
  error: string | null;
}

// ─── Main runner ───────────────────────────────────────────────────────────

export async function runAgent(options: RunAgentOptions): Promise<AgentResult> {
  const {
    prompt,
    modelName = "claude-sonnet-4-20250514",
    callbacks = {},
  } = options;

  if (!prompt) throw new Error("No prompt provided");

  const threadId = options.threadId || await createThread(prompt.slice(0, 80));

  const systemPrompt = await buildSystemPrompt({
    timezone: options.timezone,
    conversationHistory: options.conversationHistory,
  });

  // Only add system prompt if thread doesn't already have one
  const existingMessages = await getMessages(threadId);
  const hasSystemPrompt = existingMessages.some((m) => m.role === "system");
  if (!hasSystemPrompt) {
    await addMessage(threadId, "system", systemPrompt);
  }

  if (!options.skipUserMessage) {
    await addMessage(threadId, "user", prompt);
  }

  const model = getModel("anthropic", modelName as any);

  const agent = new Agent({
    streamFn: streamSimple,
    initialState: {
      systemPrompt,
      model,
      tools: allTools,
      thinkingLevel: "off",
    },
  });

  let output = "";
  let hasOutput = false;
  let agentError: string | null = null;
  let pendingText = "";
  const toolCallMap = new Map<string, { name: string; args: any }>();

  async function flushText() {
    const text = pendingText.trim();
    pendingText = "";  // Reset immediately to prevent duplicate flushes from parallel tool_starts
    if (text) {
      await addMessage(threadId, "assistant", text);
    }
  }

  const unsub = agent.subscribe((event) => {
    if ((event as any).type === "error") {
      agentError = (event as any).error?.message || (event as any).message || String((event as any).error || "Unknown agent error");
      callbacks.onError?.(agentError!);
      return;
    }
    switch (event.type) {
      case "message_update": {
        const ame = event.assistantMessageEvent;
        if (ame.type === "text_delta") {
          hasOutput = true;
          pendingText += ame.delta;
          output += ame.delta;
          callbacks.onTextDelta?.(ame.delta);
        }
        break;
      }

      case "tool_execution_start": {
        void flushText();
        toolCallMap.set(event.toolCallId, { name: event.toolName, args: event.args });
        callbacks.onToolStart?.(event.toolName, event.args);
        break;
      }

      case "tool_execution_end": {
        let resultPreview = "";
        try {
          const contents = event.result?.content ?? [];
          resultPreview = contents
            .filter((c: any) => c.type === "text")
            .map((c: any) => c.text)
            .join("\n")
            .slice(0, 2000);
        } catch {}

        const tracked = toolCallMap.get(event.toolCallId);
        void addMessage(threadId, "tool", resultPreview || "(no output)", {
          name: event.toolName || tracked?.name || "",
          args: tracked?.args ?? {},
          error: event.isError || false,
        });

        callbacks.onToolEnd?.(event.toolName, resultPreview.slice(0, 500), event.isError || false);
        toolCallMap.delete(event.toolCallId);
        break;
      }

      case "agent_end":
        void flushText();
        break;
    }
  });

  try {
    await agent.prompt(prompt);
  } finally {
    unsub();
    await flushText();
  }

  return { threadId, output, hasOutput, error: agentError };
}
