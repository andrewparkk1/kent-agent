import { Agent } from "@mariozechner/pi-agent-core";
import { streamSimple, getModel } from "@mariozechner/pi-ai";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import { allTools } from "./tools.ts";
import { getItemCount } from "@shared/db.ts";

// ---------------------------------------------------------------------------
// Environment
// ---------------------------------------------------------------------------

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY ?? "";
const RUN_ID = process.env.RUN_ID ?? "";
const PROMPT = process.env.PROMPT ?? "";
const OUTPUT_DIR = process.env.OUTPUT_DIR ?? "/outputs";
const MAX_TURNS = parseInt(process.env.MAX_TURNS ?? "20", 10);
const MODEL_NAME = process.env.MODEL ?? "claude-sonnet-4-20250514";

// ---------------------------------------------------------------------------
// Prompt assembly
// ---------------------------------------------------------------------------

// Read from ~/.kent/prompts/ first, fall back to bundled prompts
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

    const lines = Object.entries(counts).map(
      ([source, count]) => `- ${source}: ${count} items`
    );
    return `## Available Data\n${lines.join("\n")}`;
  } catch {
    return "Could not read local database.";
  }
}

function buildSystemPrompt(): string {
  const identity = readPromptFile("IDENTITY.md");
  const soul = readPromptFile("SOUL.md");
  const tools = readPromptFile("TOOLS.md");
  const userTemplate = readPromptFile("USER.md");

  // Gather skill files (merge user + bundled, user takes precedence)
  const skillContents: string[] = [];
  const seenSkills = new Set<string>();
  const skillsDirs = [
    join(USER_PROMPTS_DIR, "skills"),
    join(BUNDLED_PROMPTS_DIR, "skills"),
  ];
  for (const skillsDir of skillsDirs) {
    try {
      for (const name of readdirSync(skillsDir)) {
        if (!name.endsWith(".md") || seenSkills.has(name)) continue;
        seenSkills.add(name);
        const content = readFileSync(join(skillsDir, name), "utf-8");
        if (content) skillContents.push(`# Skill: ${name}\n\n${content}`);
      }
    } catch {
      // Directory doesn't exist
    }
  }

  const today = new Date().toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  const context = getContext();

  const user = userTemplate
    .replace(/\{\{DATE\}\}/g, today)
    .replace(/\{\{CONTEXT\}\}/g, context);

  const identityResolved = identity.replace(/\{\{DATE\}\}/g, today);

  const parts = [identityResolved, soul, tools, ...skillContents, user].filter(Boolean);
  return parts.join("\n\n---\n\n");
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function run(): Promise<void> {
  if (!PROMPT) {
    console.error("No PROMPT provided");
    process.exit(1);
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

  const unsub = agent.subscribe((event) => {
    switch (event.type) {
      case "message_update": {
        const ame = event.assistantMessageEvent;
        if (ame.type === "text_delta") {
          process.stdout.write(ame.delta);
        }
        break;
      }
      case "tool_execution_start":
        console.error(
          JSON.stringify({ event: "tool_start", name: event.toolName, args: event.args })
        );
        break;
      case "tool_execution_end": {
        // Extract text preview from result content
        let preview = "";
        try {
          const contents = event.result?.content ?? [];
          const texts = contents
            .filter((c: any) => c.type === "text")
            .map((c: any) => c.text);
          preview = texts.join("\n").slice(0, 500);
        } catch {}
        console.error(
          JSON.stringify({
            event: "tool_end",
            name: event.toolName,
            error: event.isError,
            result: preview,
          })
        );
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
        process.stdout.write("\n");
        break;
    }
  });

  try {
    await agent.prompt(PROMPT);
  } finally {
    unsub();
  }

  // Write output file
  const messages = agent.state.messages;
  const lastAssistant = [...messages]
    .reverse()
    .find((m) => "role" in m && m.role === "assistant");

  if (lastAssistant && "content" in lastAssistant) {
    const textParts = (lastAssistant.content as any[])
      .filter((c: any) => c.type === "text")
      .map((c: any) => c.text);
    const outputText = textParts.join("");

    if (OUTPUT_DIR && RUN_ID) {
      try {
        const { mkdirSync, writeFileSync } = await import("node:fs");
        mkdirSync(OUTPUT_DIR, { recursive: true });
        writeFileSync(
          join(OUTPUT_DIR, "output.md"),
          outputText,
          "utf-8"
        );
      } catch (e) {
        console.error(`Failed to write output: ${e}`);
      }
    }
  }
}

run().catch((err) => {
  console.error("Agent fatal error:", err);
  process.exit(1);
});
