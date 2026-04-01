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

  const threadId = existingThreadId || createThread(message.slice(0, 80));
  addMessage(threadId, "user", message);

  const config = loadConfig();
  const runner = new LocalRunner(config);

  const history = getMessages(threadId, 50);
  const conversationContext = history.length > 1
    ? history.slice(0, -1).map((m) => `${m.role}: ${m.content}`).join("\n\n") + "\n\nuser: " + message
    : message;

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      controller.enqueue(encoder.encode(`data: ${JSON.stringify({ threadId })}\n\n`));

      let fullResponse = "";
      let stderrOutput = "";
      let toolBuffer = "";

      try {
        const result = await runner.run(conversationContext, undefined, (chunk: string, type: "text" | "tool") => {
          if (type === "text") {
            // If there was a pending tool call, save it before the text
            if (toolBuffer.trim()) {
              addMessage(threadId, "system", toolBuffer.trim());
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({ tool: toolBuffer.trim() })}\n\n`));
              toolBuffer = "";
            }
            fullResponse += chunk;
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ delta: chunk })}\n\n`));
          } else {
            toolBuffer += chunk;
            stderrOutput += chunk;
          }
        }, { threadId });

        // Save any remaining tool output
        if (toolBuffer.trim()) {
          addMessage(threadId, "system", toolBuffer.trim());
        }

        if (fullResponse.trim()) {
          addMessage(threadId, "assistant", fullResponse.trim());
        } else {
          const errMsg = stderrOutput.includes("401") || stderrOutput.includes("auth")
            ? "Agent authentication failed. Check your Anthropic API key in ~/.kent/config.json or set ANTHROPIC_API_KEY."
            : stderrOutput.includes("error")
              ? `Agent error: ${stderrOutput.slice(0, 300)}`
              : "Agent returned no response. Check that your Anthropic API key is valid (run `kent init` to reconfigure).";
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
