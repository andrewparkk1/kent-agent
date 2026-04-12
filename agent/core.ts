/**
 * Core agent logic extracted as a callable function.
 * Can be invoked in-process (no subprocess spawn needed) or from the CLI entry point.
 */
import { Agent } from "@mariozechner/pi-agent-core";
import { streamSimple } from "@mariozechner/pi-ai";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import { allTools } from "./tools/index.ts";
import { getItemCount, createThread, addMessage, getMessages, listMemories } from "@shared/db.ts";
import { loadConfig } from "@shared/config.ts";
import { resolveModel } from "@shared/models.ts";

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
  /** Fires when the agent re-emits text identical to (or a prefix of) an already-flushed segment.
   *  UI should drop the in-flight assistant bubble to avoid visible duplication. */
  onSegmentRollback?: () => void;
}

export interface RunAgentOptions {
  prompt: string;
  threadId?: string;
  modelName?: string;
  provider?: string;
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

  // Resolve model from config — supports anthropic, openai, openrouter, google, local, and custom providers
  const config = loadConfig();
  // Allow env overrides for provider/model (used by agent.ts subprocess entry point)
  if (options.provider) {
    (config.agent as any).provider = options.provider;
  }
  if (options.modelName) {
    config.agent.default_model = options.modelName;
  }
  const resolved = resolveModel(config);
  const model = resolved.model;
  const streamApiKey = resolved.apiKey;
  const modelMeta = { model: model.id, provider: config.agent.provider };

  const agent = new Agent({
    streamFn: streamSimple,
    initialState: {
      systemPrompt,
      model,
      tools: allTools,
      thinkingLevel: "off",
    },
    ...(streamApiKey ? { getApiKey: () => streamApiKey } : {}),
  });

  let output = "";
  let hasOutput = false;
  let agentError: string | null = null;
  let pendingText = "";
  let flushPromise: Promise<void> = Promise.resolve();
  const toolCallMap = new Map<string, { name: string; args: any }>();

  // Dedup state: track every assistant segment we've already committed this run.
  // If the model re-emits the same text in a later turn (common when it calls
  // another tool after "finishing" an answer), we skip the DB write AND signal
  // the client to drop the in-flight bubble so the user never sees the dupe.
  const flushedSegments: string[] = [];
  let currentSegmentRolledBack = false;

  function isDuplicateSegment(text: string): boolean {
    if (!text) return false;
    // Exact match OR one contains the other (handles partial regeneration).
    return flushedSegments.some(
      (prev) => prev === text || prev.includes(text) || text.includes(prev),
    );
  }

  function flushText() {
    const text = pendingText.trim();
    pendingText = "";  // Reset immediately to prevent duplicate flushes from parallel tool_starts.
    const wasRolledBack = currentSegmentRolledBack;
    currentSegmentRolledBack = false;
    if (!text) return flushPromise;
    if (wasRolledBack || isDuplicateSegment(text)) {
      // Already committed this content earlier — don't write again.
      // If we detected it late (not already rolled back live), signal the
      // client now so it can drop whatever it was showing.
      if (!wasRolledBack) callbacks.onSegmentRollback?.();
      return flushPromise;
    }
    flushedSegments.push(text);
    flushPromise = flushPromise.then(async () => { await addMessage(threadId, "assistant", text, modelMeta); });
    return flushPromise;
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
          output += ame.delta;
          if (currentSegmentRolledBack) {
            // Segment already flagged as duplicate — keep consuming deltas
            // so `output` stays accurate, but don't forward to the client
            // or accumulate into pendingText (it won't be flushed).
            break;
          }
          pendingText += ame.delta;
          callbacks.onTextDelta?.(ame.delta);
          // Early rollback: as soon as pendingText matches a prior segment,
          // tell the client to drop the bubble before more deltas pile on.
          if (isDuplicateSegment(pendingText.trim())) {
            currentSegmentRolledBack = true;
            pendingText = "";
            callbacks.onSegmentRollback?.();
          }
        }
        break;
      }

      case "tool_execution_start": {
        flushText();
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
        flushText();
        break;
    }
  });

  try {
    await agent.prompt(prompt);
  } finally {
    unsub();
    flushText();          // queue any remaining text
    await flushPromise;   // wait for all writes to complete
  }

  return { threadId, output, hasOutput, error: agentError };
}
