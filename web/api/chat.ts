/** POST /api/chat — SSE streaming chat with the agent. */
import { createThread, addMessage, getMessages, finishThread } from "../../shared/db.ts";
import { loadConfig } from "../../shared/config.ts";
import { InProcessRunner } from "../../daemon/inprocess-runner.ts";

/** Track in-flight agent runs so they survive client disconnects. */
const activeRuns = new Map<string, Promise<void>>();

export async function handleChat(req: Request) {
  const body = await req.json();
  const { threadId: existingThreadId, message } = body as { threadId?: string; message: string };

  if (!message?.trim()) {
    return Response.json({ error: "Message is required" }, { status: 400 });
  }

  const threadId = existingThreadId || await createThread(message.slice(0, 80));

  // Store user message here (agent will skip it via SKIP_USER_MESSAGE)
  await addMessage(threadId, "user", message);

  // Build prior conversation context (everything BEFORE the current message)
  const history = await getMessages(threadId, 50);
  // Exclude the message we just added — it becomes the PROMPT
  const priorMessages = history
    .filter((m) => m.role === "user" || m.role === "assistant")
    .slice(0, -1); // Drop the last (current) user message

  const config = loadConfig();
  const runner = new InProcessRunner(config);

  const encoder = new TextEncoder();
  let clientConnected = true;

  /** Safe enqueue — no-ops if the client already disconnected. */
  const safeSend = (controller: ReadableStreamDefaultController, data: string) => {
    if (!clientConnected) return;
    try { controller.enqueue(encoder.encode(data)); } catch {}
  };

  // Mark thread as running so the UI can poll for updates if client reconnects
  await finishThread(threadId, "running");

  // Build conversation context
  const conversationHistory = priorMessages.length > 0
    ? priorMessages.map((m) => `${m.role === "user" ? "Human" : "Assistant"}: ${m.content}`).join("\n\n")
    : "";

  // SSE heartbeat — keeps the connection alive during long tool calls / LLM thinking
  const heartbeat = setInterval(() => {
    if (clientConnected && streamController) {
      safeSend(streamController, ": heartbeat\n\n");
    }
  }, 3_000);

  // Wait for the stream controller to be ready before starting the agent
  let streamController: ReadableStreamDefaultController | null = null;
  let resolveControllerReady!: () => void;
  const controllerReady = new Promise<void>((resolve) => { resolveControllerReady = resolve; });

  const stream = new ReadableStream({
    start(controller) {
      streamController = controller;
      safeSend(controller, `data: ${JSON.stringify({ threadId })}\n\n`);
      resolveControllerReady!();
    },
    cancel() {
      console.log("[chat] client disconnected — agent continues in background for thread:", threadId);
      clientConnected = false;
      streamController = null;
      clearInterval(heartbeat);
      // Don't kill the runner — let it finish and save to DB
    },
  });

  // Launch the agent run as a detached background task.
  // It writes messages to DB as it goes, so it survives client disconnects.
  const runPromise = (async () => {
    // Wait for the stream controller to be assigned before emitting any events
    await controllerReady;

    let stderrOutput = "";

    try {
      console.log("[chat] starting runner.run for thread:", threadId, "history msgs:", priorMessages.length);
      const result = await runner.run(message, undefined, (chunk: string, type: "text" | "tool") => {
        if (type === "text") {
          if (clientConnected && streamController) {
            safeSend(streamController, `data: ${JSON.stringify({ delta: chunk })}\n\n`);
          }
        } else {
          stderrOutput += chunk;
          if (clientConnected && streamController) {
            safeSend(streamController, `data: ${JSON.stringify({ tool: chunk })}\n\n`);
          }
        }
      }, { threadId, conversationHistory });

      console.log("[chat] runner finished. exitCode:", result.exitCode);

      // Check if agent produced any output
      if (!result.output?.trim() && (stderrOutput || result.exitCode !== 0)) {
        const errSource = (stderrOutput || result.stderr || "Unknown error").trim();
        let errMsg: string;
        if (errSource.includes("401") || errSource.includes("auth") || errSource.includes("API key")) {
          errMsg = "Authentication failed. Check your Anthropic API key in Settings.";
        } else if (errSource.startsWith("Agent error:") || errSource.startsWith("Agent fatal error:")) {
          errMsg = errSource;
        } else {
          errMsg = `Agent error: ${errSource.slice(0, 500)}`;
        }
        await addMessage(threadId, "assistant", errMsg);
        if (clientConnected && streamController) {
          safeSend(streamController, `data: ${JSON.stringify({ delta: errMsg })}\n\n`);
        }
      }

      await finishThread(threadId, result.exitCode === 0 ? "done" : "error");
    } catch (e) {
      console.error("[chat] agent run error:", e);
      await finishThread(threadId, "error");
      if (clientConnected && streamController) {
        safeSend(streamController, `data: ${JSON.stringify({ error: String(e) })}\n\n`);
      }
    } finally {
      clearInterval(heartbeat);
      activeRuns.delete(threadId);
      // Close the SSE stream if client is still connected
      if (clientConnected && streamController) {
        safeSend(streamController, "data: [DONE]\n\n");
        try { streamController.close(); } catch {}
      }
    }
  })();

  activeRuns.set(threadId, runPromise);

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
    },
  });
}
