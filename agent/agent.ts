/**
 * Kent's AI brain. Loads prompt files, runs a multi-turn agent loop with tools.
 * Writes messages (user, assistant, tool) to the DB as they stream in.
 * Invoked as a subprocess — reads PROMPT/THREAD_ID from env.
 */
import { Agent } from "@mariozechner/pi-agent-core";
import { streamSimple, getModel } from "@mariozechner/pi-ai";
import { existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import { allTools } from "./tools/index.ts";
import { getItemCount, createThread, addMessage } from "@shared/db.ts";

// ─── Environment ────────────────────────────────────────────────────────────

const PROMPT = process.env.PROMPT ?? "";
const THREAD_ID = process.env.THREAD_ID ?? "";
const SKIP_USER_MESSAGE = process.env.SKIP_USER_MESSAGE === "1"; // Caller already stored user msg
const MODEL_NAME = process.env.MODEL ?? "claude-sonnet-4-20250514";
const CONVERSATION_HISTORY = process.env.CONVERSATION_HISTORY ?? "";

// ─── Prompt assembly ────────────────────────────────────────────────────────

const USER_PROMPTS_DIR = join(homedir(), ".kent", "prompts");
const BUNDLED_PROMPTS_DIR = join(dirname(import.meta.path), "prompts");

function readPromptFile(name: string): string {
  const userPath = join(USER_PROMPTS_DIR, name);
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

async function buildSystemPrompt(): Promise<string> {
  const identity = readPromptFile("IDENTITY.md");
  const soul = readPromptFile("SOUL.md");
  const tools = readPromptFile("TOOLS.md");
  const userTemplate = readPromptFile("USER.md");

  const tz = process.env.TIMEZONE || Intl.DateTimeFormat().resolvedOptions().timeZone;
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

  const parts = [identityResolved, soul, tools, user].filter(Boolean);

  // Inject prior conversation history so the agent has multi-turn context
  if (CONVERSATION_HISTORY) {
    parts.push(`## Conversation History\n\nBelow is the prior conversation in this thread. The user's latest message (your current task) follows as the user prompt. Pay close attention to the MOST RECENT messages — if the user is correcting, cancelling, or changing a previous request, follow their latest instructions.\n\n${CONVERSATION_HISTORY}`);
  }

  return parts.join("\n\n---\n\n");
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function run(): Promise<void> {
  if (!PROMPT) {
    console.error("No PROMPT provided");
    process.exit(1);
  }

  // Resolve or create thread
  const threadId = THREAD_ID || await createThread(PROMPT.slice(0, 80));

  // Store the user message (unless caller already did it)
  if (!SKIP_USER_MESSAGE) {
    await addMessage(threadId, "user", PROMPT);
  }

  const systemPrompt = await buildSystemPrompt();

  // Always store the system prompt so it's visible in the UI
  await addMessage(threadId, "system", systemPrompt);

  const model = getModel("anthropic", MODEL_NAME as any);

  const agent = new Agent({
    streamFn: streamSimple,
    initialState: {
      systemPrompt,
      model,
      tools: allTools,
      thinkingLevel: "off",
    },
  });

  let pendingText = ""; // Accumulated assistant text, flushed on tool start or agent end
  let currentToolName = "";
  let currentToolArgs: any = {};

  async function flushText() {
    if (pendingText.trim()) {
      await addMessage(threadId, "assistant", pendingText.trim());
      pendingText = "";
    }
  }

  let hasOutput = false;
  let agentError: string | null = null;

  const unsub = agent.subscribe((event) => {
    switch (event.type) {
      case "message_update": {
        const ame = event.assistantMessageEvent;
        if (ame.type === "text_delta") {
          hasOutput = true;
          pendingText += ame.delta;
          process.stdout.write(ame.delta);
        }
        break;
      }

      case "error": {
        agentError = (event as any).error?.message || (event as any).message || String((event as any).error || "Unknown agent error");
        console.error(JSON.stringify({ event: "agent_error", error: agentError }));
        break;
      }

      case "tool_execution_start": {
        // Flush any accumulated text before the tool call
        void flushText();
        currentToolName = event.toolName;
        currentToolArgs = event.args;
        // Still write to stderr for the REPL/web stream
        console.error(JSON.stringify({ event: "tool_start", name: event.toolName, args: event.args }));
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

        // Store tool call as a message
        void addMessage(threadId, "tool", resultPreview || "(no output)", {
          name: currentToolName,
          args: currentToolArgs,
          error: event.isError || false,
        });

        console.error(JSON.stringify({
          event: "tool_end",
          name: event.toolName,
          error: event.isError,
          result: resultPreview.slice(0, 500),
        }));

        currentToolName = "";
        currentToolArgs = {};
        break;
      }

      case "turn_end":
        break;

      case "agent_end":
        // Flush any remaining text
        void flushText();
        process.stdout.write("\n");
        break;
    }
  });

  try {
    await agent.prompt(PROMPT);
  } finally {
    unsub();
    // Safety flush in case agent_end didn't fire
    await flushText();
  }

  // If agent produced no output, something went wrong (e.g. bad API key)
  if (!hasOutput) {
    const msg = agentError || "Agent produced no output. Check your API key and model settings.";
    console.error("Agent error:", msg);
    process.exit(1);
  }
}

run().catch((err) => {
  console.error("Agent fatal error:", err);
  process.exit(1);
});
