/**
 * Kent's AI brain — CLI subprocess entry point.
 * Reads PROMPT/THREAD_ID from env, runs the agent, streams to stdout/stderr.
 *
 * For the web app, use agent/core.ts directly via InProcessRunner (no subprocess needed).
 */
import { runAgent } from "./core.ts";

const PROMPT = process.env.PROMPT ?? "";
const THREAD_ID = process.env.THREAD_ID ?? "";
const SKIP_USER_MESSAGE = process.env.SKIP_USER_MESSAGE === "1";
const MODEL_NAME = process.env.MODEL ?? "";
const PROVIDER = process.env.PROVIDER ?? "";
const CONVERSATION_HISTORY = process.env.CONVERSATION_HISTORY ?? "";

async function run(): Promise<void> {
  if (!PROMPT) {
    console.error("No PROMPT provided");
    process.exit(1);
  }

  const result = await runAgent({
    prompt: PROMPT,
    threadId: THREAD_ID || undefined,
    ...(MODEL_NAME ? { modelName: MODEL_NAME } : {}),
    ...(PROVIDER ? { provider: PROVIDER } : {}),
    timezone: process.env.TIMEZONE,
    conversationHistory: CONVERSATION_HISTORY || undefined,
    skipUserMessage: SKIP_USER_MESSAGE,
    callbacks: {
      onTextDelta: (delta) => process.stdout.write(delta),
      onToolStart: (name, args) => console.error(JSON.stringify({ event: "tool_start", name, args })),
      onToolEnd: (name, result, isError) => console.error(JSON.stringify({ event: "tool_end", name, error: isError, result })),
      onError: (error) => console.error(JSON.stringify({ event: "agent_error", error })),
    },
  });

  if (!result.hasOutput) {
    const msg = result.error || "Agent produced no output. Check your API key and model settings.";
    console.error("Agent error:", msg);
    process.exit(1);
  }

  process.stdout.write("\n");
}

run().catch((err) => {
  console.error("Agent fatal error:", err);
  process.exit(1);
});
