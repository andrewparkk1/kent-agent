/**
 * Runs the agent in-process — no subprocess spawn, no pipe buffering.
 * Text deltas go directly from the Anthropic stream to the SSE response.
 */
import { BaseRunner, type RunResult, type StreamCallback, type TypedStreamCallback } from "./runner-base.ts";
import { runAgent, type AgentCallbacks } from "../agent/core.ts";
import type { Config } from "@shared/config.ts";

export class InProcessRunner extends BaseRunner {
  private config: Config;
  private aborted = false;

  constructor(config: Config) {
    super();
    this.config = config;
  }

  async run(
    prompt: string,
    workflowId?: string,
    streamCallback?: StreamCallback | TypedStreamCallback,
    options?: { threadId?: string; conversationHistory?: string }
  ): Promise<RunResult> {
    this.aborted = false;
    const runId = crypto.randomUUID();

    const emit = streamCallback
      ? streamCallback.length >= 2
        ? (chunk: string, type: "text" | "tool") => (streamCallback as TypedStreamCallback)(chunk, type)
        : (chunk: string, _type: "text" | "tool") => (streamCallback as StreamCallback)(chunk)
      : null;

    const callbacks: AgentCallbacks = {
      onTextDelta: (delta) => {
        if (!this.aborted) emit?.(delta, "text");
      },
      onToolStart: (name, args) => {
        if (!this.aborted) emit?.(JSON.stringify({ event: "tool_start", name, args }), "tool");
      },
      onToolEnd: (name, result, isError) => {
        if (!this.aborted) emit?.(JSON.stringify({ event: "tool_end", name, error: isError, result }), "tool");
      },
      onError: (error) => {
        if (!this.aborted) emit?.(JSON.stringify({ event: "agent_error", error }), "tool");
      },
      onSegmentRollback: () => {
        if (!this.aborted) emit?.(JSON.stringify({ event: "segment_rollback" }), "tool");
      },
    };

    let stderrOutput = "";
    const origOnToolStart = callbacks.onToolStart!;
    const origOnToolEnd = callbacks.onToolEnd!;
    const origOnError = callbacks.onError!;
    callbacks.onToolStart = (name, args) => {
      const msg = JSON.stringify({ event: "tool_start", name, args });
      stderrOutput += msg;
      if (!this.aborted) emit?.(msg, "tool");
    };
    callbacks.onToolEnd = (name, result, isError) => {
      const msg = JSON.stringify({ event: "tool_end", name, error: isError, result });
      stderrOutput += msg;
      if (!this.aborted) emit?.(msg, "tool");
    };
    callbacks.onError = (error) => {
      const msg = JSON.stringify({ event: "agent_error", error });
      stderrOutput += msg;
      if (!this.aborted) emit?.(msg, "tool");
    };

    // Ensure the API key is available in the environment for the Anthropic SDK
    if (this.config.keys.anthropic && !process.env.ANTHROPIC_API_KEY) {
      process.env.ANTHROPIC_API_KEY = this.config.keys.anthropic;
    }

    try {
      const result = await runAgent({
        prompt,
        threadId: options?.threadId,
        modelName: this.config.agent.default_model,
        timezone: this.config.core.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone,
        conversationHistory: options?.conversationHistory,
        skipUserMessage: !!options?.threadId,
        callbacks,
      });

      return {
        runId,
        output: result.output,
        files: {},
        stderr: stderrOutput,
        exitCode: result.error ? 1 : 0,
      };
    } catch (err) {
      return {
        runId,
        output: "",
        files: {},
        stderr: stderrOutput + String(err),
        exitCode: 1,
      };
    }
  }

  async kill(): Promise<void> {
    this.aborted = true;
    // In-process agent doesn't have a subprocess to kill,
    // but setting aborted prevents further callbacks from firing.
  }
}
