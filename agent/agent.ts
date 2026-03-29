import { Agent } from "@mariozechner/pi-agent-core";
import { streamSimple, getModel } from "@mariozechner/pi-ai";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { allTools } from "./tools.ts";

// ---------------------------------------------------------------------------
// Environment
// ---------------------------------------------------------------------------

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY ?? "";
const CONVEX_URL = process.env.CONVEX_URL ?? "";
const DEVICE_TOKEN = process.env.DEVICE_TOKEN ?? "";
const RUN_ID = process.env.RUN_ID ?? "";
const PROMPT = process.env.PROMPT ?? "";
const OUTPUT_DIR = process.env.OUTPUT_DIR ?? "/outputs";
const RUNNER = process.env.RUNNER ?? "cloud";
const MAX_TURNS = parseInt(process.env.MAX_TURNS ?? "20", 10);
const KENT_HOME = process.env.KENT_HOME ?? dirname(dirname(import.meta.dir));
const MODEL_NAME = process.env.MODEL ?? "claude-sonnet-4-20250514";

// ---------------------------------------------------------------------------
// Prompt assembly
// ---------------------------------------------------------------------------

function readPromptFile(name: string): string {
  const promptsDir = join(dirname(import.meta.path), "prompts");
  try {
    return readFileSync(join(promptsDir, name), "utf-8");
  } catch {
    return "";
  }
}

async function fetchContext(): Promise<string> {
  if (!CONVEX_URL || !DEVICE_TOKEN) {
    return "No Convex connection configured. Memory tools will not work.";
  }

  try {
    const url = CONVEX_URL.replace(/\/$/, "");
    const res = await fetch(`${url}/api/query`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        path: "items:getStats",
        args: { deviceToken: DEVICE_TOKEN },
      }),
    });

    if (!res.ok) return "Could not fetch source stats.";

    const data = (await res.json()) as { status: string; value?: unknown };
    if (data.status === "error") return "Could not fetch source stats.";

    const stats = data.value as Record<
      string,
      { count: number; earliest: number; latest: number }
    >;

    const lines = Object.entries(stats).map(([source, s]) => {
      const earliest = new Date(s.earliest).toLocaleDateString();
      const latest = new Date(s.latest).toLocaleDateString();
      return `- ${source}: ${s.count} items (${earliest} — ${latest})`;
    });

    return lines.length > 0
      ? `## Available Data\n${lines.join("\n")}`
      : "No synced data available yet. Run `kent sync` to populate.";
  } catch {
    return "Could not connect to Convex.";
  }
}

async function buildSystemPrompt(): Promise<string> {
  const identity = readPromptFile("IDENTITY.md");
  const soul = readPromptFile("SOUL.md");
  const tools = readPromptFile("TOOLS.md");
  const userTemplate = readPromptFile("USER.md");

  const today = new Date().toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  const context = await fetchContext();

  const user = userTemplate
    .replace(/\{\{DATE\}\}/g, today)
    .replace(/\{\{CONTEXT\}\}/g, context);

  // Also replace {{DATE}} in identity
  const identityResolved = identity.replace(/\{\{DATE\}\}/g, today);

  return [identityResolved, soul, tools, user].filter(Boolean).join("\n\n---\n\n");
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function run(): Promise<void> {
  if (!PROMPT) {
    console.error("No PROMPT provided");
    process.exit(1);
  }

  const systemPrompt = await buildSystemPrompt();

  // Resolve model — default to Anthropic Claude Sonnet
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

  // Track turns for max_turns limit
  let turnCount = 0;

  const unsub = agent.subscribe((event) => {
    switch (event.type) {
      case "message_update": {
        // Stream text deltas to stdout
        const ame = event.assistantMessageEvent;
        if (ame.type === "text_delta") {
          process.stdout.write(ame.delta);
        }
        break;
      }
      case "tool_execution_start":
        console.error(
          `\n[${event.toolName}] ${JSON.stringify(event.args).slice(0, 200)}`
        );
        break;
      case "tool_execution_end":
        if (event.isError) {
          console.error(`[${event.toolName}] ERROR`);
        } else {
          console.error(`[${event.toolName}] done`);
        }
        break;
      case "turn_end":
        turnCount++;
        if (turnCount >= MAX_TURNS) {
          console.error(`\nMax turns (${MAX_TURNS}) reached, stopping.`);
          agent.abort();
        }
        break;
      case "agent_end":
        // Final newline
        process.stdout.write("\n");
        break;
    }
  });

  try {
    await agent.prompt(PROMPT);
  } finally {
    unsub();
  }

  // Collect final assistant text for output
  const messages = agent.state.messages;
  const lastAssistant = [...messages]
    .reverse()
    .find((m) => "role" in m && m.role === "assistant");

  if (lastAssistant && "content" in lastAssistant) {
    const textParts = (lastAssistant.content as any[])
      .filter((c: any) => c.type === "text")
      .map((c: any) => c.text);
    const outputText = textParts.join("");

    // Write output to file if OUTPUT_DIR is set
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
