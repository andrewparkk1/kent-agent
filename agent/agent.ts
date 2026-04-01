/**
 * Kent's AI brain. Loads prompt files, runs a multi-turn agent loop with tools.
 * Writes messages (user, assistant, tool) to the DB as they stream in.
 * Invoked as a subprocess — reads PROMPT/THREAD_ID from env.
 */
import { Agent } from "@mariozechner/pi-agent-core";
import { streamSimple, getModel } from "@mariozechner/pi-ai";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import { allTools } from "./tools/index.ts";
import { getItemCount, createThread, addMessage } from "@shared/db.ts";

// ─── Environment ────────────────────────────────────────────────────────────

const PROMPT = process.env.PROMPT ?? "";
const THREAD_ID = process.env.THREAD_ID ?? "";
const SKIP_USER_MESSAGE = process.env.SKIP_USER_MESSAGE === "1"; // Caller already stored user msg
const MAX_TURNS = parseInt(process.env.MAX_TURNS ?? "20", 10);
const MODEL_NAME = process.env.MODEL ?? "claude-sonnet-4-20250514";

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

function getContext(): string {
  try {
    const counts = getItemCount();
    if (Object.keys(counts).length === 0) {
      return "No synced data available yet. Run `kent sync` to populate.";
    }
    return `## Available Data\n${Object.entries(counts).map(([s, c]) => `- ${s}: ${c} items`).join("\n")}`;
  } catch {
    return "Could not read local database.";
  }
}

function buildSystemPrompt(): string {
  const identity = readPromptFile("IDENTITY.md");
  const soul = readPromptFile("SOUL.md");
  const tools = readPromptFile("TOOLS.md");
  const userTemplate = readPromptFile("USER.md");

  // Load skills from nested dirs (skills/<name>/SKILL.md) with flat file fallback
  const skillContents: string[] = [];
  const seenSkills = new Set<string>();
  for (const skillsDir of [join(USER_PROMPTS_DIR, "skills"), join(BUNDLED_PROMPTS_DIR, "skills")]) {
    try {
      for (const entry of readdirSync(skillsDir)) {
        if (seenSkills.has(entry)) continue;
        const entryPath = join(skillsDir, entry);
        // Nested: skills/<name>/SKILL.md
        if (statSync(entryPath).isDirectory()) {
          const skillFile = join(entryPath, "SKILL.md");
          if (existsSync(skillFile)) {
            seenSkills.add(entry);
            const content = readFileSync(skillFile, "utf-8");
            if (content) skillContents.push(`# Skill: ${entry}\n\n${content}`);
          }
        // Legacy flat: skills/<name>.md
        } else if (entry.endsWith(".md")) {
          const name = entry.replace(/\.md$/, "");
          seenSkills.add(name);
          const content = readFileSync(entryPath, "utf-8");
          if (content) skillContents.push(`# Skill: ${name}\n\n${content}`);
        }
      }
    } catch {}
  }

  const today = new Date().toLocaleDateString("en-US", {
    weekday: "long", year: "numeric", month: "long", day: "numeric",
  });

  const user = userTemplate.replace(/\{\{DATE\}\}/g, today).replace(/\{\{CONTEXT\}\}/g, getContext());
  const identityResolved = identity.replace(/\{\{DATE\}\}/g, today);

  return [identityResolved, soul, tools, ...skillContents, user].filter(Boolean).join("\n\n---\n\n");
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function run(): Promise<void> {
  if (!PROMPT) {
    console.error("No PROMPT provided");
    process.exit(1);
  }

  // Resolve or create thread
  const threadId = THREAD_ID || createThread(PROMPT.slice(0, 80));

  // Store the user message (unless caller already did it)
  if (!SKIP_USER_MESSAGE) {
    addMessage(threadId, "user", PROMPT);
  }

  const systemPrompt = buildSystemPrompt();
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

  let turnCount = 0;
  let pendingText = ""; // Accumulated assistant text, flushed on tool start or agent end
  let currentToolName = "";
  let currentToolArgs: any = {};

  function flushText() {
    if (pendingText.trim()) {
      addMessage(threadId, "assistant", pendingText.trim());
      pendingText = "";
    }
  }

  const unsub = agent.subscribe((event) => {
    switch (event.type) {
      case "message_update": {
        const ame = event.assistantMessageEvent;
        if (ame.type === "text_delta") {
          pendingText += ame.delta;
          process.stdout.write(ame.delta);
        }
        break;
      }

      case "tool_execution_start": {
        // Flush any accumulated text before the tool call
        flushText();
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
        addMessage(threadId, "tool", resultPreview || "(no output)", {
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
        turnCount++;
        if (turnCount >= MAX_TURNS) {
          console.error(`\nMax turns (${MAX_TURNS}) reached, stopping.`);
          agent.abort();
        }
        break;

      case "agent_end":
        // Flush any remaining text
        flushText();
        process.stdout.write("\n");
        break;
    }
  });

  try {
    await agent.prompt(PROMPT);
  } finally {
    unsub();
    // Safety flush in case agent_end didn't fire
    flushText();
  }
}

run().catch((err) => {
  console.error("Agent fatal error:", err);
  process.exit(1);
});
