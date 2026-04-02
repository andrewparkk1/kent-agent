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

  // Build conversation context from history (includes the message we just added)
  const history = await getMessages(threadId, 50);
  const fullPrompt = history
    .filter((m) => m.role === "user" || m.role === "assistant")
    .map((m) => `${m.role === "user" ? "Human" : "Assistant"}: ${m.content}`)
    .join("\n\n");

  const config = loadConfig();
  const runner = new LocalRunner(config);

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      controller.enqueue(encoder.encode(`data: ${JSON.stringify({ threadId })}\n\n`));

      let stderrOutput = "";
      let textBuffer = "";
      let flushTimer: ReturnType<typeof setTimeout> | null = null;

      const flushText = () => {
        if (textBuffer) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ delta: textBuffer })}\n\n`));
          textBuffer = "";
        }
        if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
      };

      try {
        const result = await runner.run(fullPrompt, undefined, (chunk: string, type: "text" | "tool") => {
          if (type === "text") {
            textBuffer += chunk;
            // Batch small chunks, flush every 30ms or when buffer is large
            if (textBuffer.length > 100) {
              flushText();
            } else if (!flushTimer) {
              flushTimer = setTimeout(flushText, 30);
            }
          } else {
            flushText(); // Flush text before tool events
            stderrOutput += chunk;
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ tool: chunk })}\n\n`));
          }
        }, { threadId });
        flushText();

        // Check if agent produced any output
        if (!result.output?.trim() && stderrOutput) {
          const errMsg = stderrOutput.includes("401") || stderrOutput.includes("auth")
            ? "Agent authentication failed. Check your Anthropic API key."
            : `Agent error: ${stderrOutput.slice(0, 300)}`;
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ delta: errMsg })}\n\n`));
        }

        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      } catch (e) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ error: String(e) })}\n\n`));
      } finally {
        controller.close();
      }
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
