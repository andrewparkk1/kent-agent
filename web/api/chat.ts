/** POST /api/chat — SSE streaming chat with the agent. */
import { createThread, addMessage, getMessages } from "../../shared/db.ts";
import { loadConfig } from "../../shared/config.ts";
import { LocalRunner } from "../../daemon/local-runner.ts";

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
  const runner = new LocalRunner(config);

  const encoder = new TextEncoder();
  let cancelled = false;

  /** Safe enqueue — no-ops if the client already disconnected. */
  const safeSend = (controller: ReadableStreamDefaultController, data: string) => {
    if (cancelled) return;
    try { controller.enqueue(encoder.encode(data)); } catch {}
  };

  const stream = new ReadableStream({
    async start(controller) {
      safeSend(controller, `data: ${JSON.stringify({ threadId })}\n\n`);

      let stderrOutput = "";
      let textBuffer = "";
      let flushTimer: ReturnType<typeof setTimeout> | null = null;

      const flushText = () => {
        if (cancelled) return;
        if (textBuffer) {
          safeSend(controller, `data: ${JSON.stringify({ delta: textBuffer })}\n\n`);
          textBuffer = "";
        }
        if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
      };

      try {
        // Pass prior conversation as context so the agent understands the thread
        const conversationHistory = priorMessages.length > 0
          ? priorMessages.map((m) => `${m.role === "user" ? "Human" : "Assistant"}: ${m.content}`).join("\n\n")
          : "";

        console.log("[chat] starting runner.run for thread:", threadId, "history msgs:", priorMessages.length);
        const result = await runner.run(message, undefined, (chunk: string, type: "text" | "tool") => {
          if (cancelled) return;
          if (type === "text") {
            textBuffer += chunk;
            // Flush immediately once we have any reasonable amount of text;
            // the client already coalesces via requestAnimationFrame.
            if (textBuffer.length > 1) {
              flushText();
            } else if (!flushTimer) {
              flushTimer = setTimeout(flushText, 8);
            }
          } else {
            flushText();
            stderrOutput += chunk;
            safeSend(controller, `data: ${JSON.stringify({ tool: chunk })}\n\n`);
          }
        }, { threadId, conversationHistory });
        flushText();

        if (cancelled) return;

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
          safeSend(controller, `data: ${JSON.stringify({ delta: errMsg })}\n\n`);
        }

        safeSend(controller, "data: [DONE]\n\n");
      } catch (e) {
        if (!cancelled) {
          console.error("[chat] catch error:", e);
          safeSend(controller, `data: ${JSON.stringify({ error: String(e) })}\n\n`);
          safeSend(controller, "data: [DONE]\n\n");
        }
      } finally {
        if (!cancelled) {
          try { controller.close(); } catch {}
        }
      }
    },
    cancel() {
      console.log("[chat] client disconnected, killing subprocess");
      cancelled = true;
      runner.kill().catch(() => {});
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
    },
  });
}
