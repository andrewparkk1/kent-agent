/** Shared helpers for agent tool implementations. */
import type { AgentToolResult } from "@mariozechner/pi-agent-core";

export const OUTPUT_DIR = process.env.OUTPUT_DIR ?? "/outputs";

export function ok(text: string): AgentToolResult<undefined> {
  return { content: [{ type: "text", text }], details: undefined };
}

export function err(text: string): AgentToolResult<undefined> {
  return { content: [{ type: "text", text }], details: undefined };
}

export function json(data: unknown): AgentToolResult<undefined> {
  return ok(JSON.stringify(data, null, 2));
}
