/**
 * Base runner interface and abstract class.
 *
 * Runners execute the agent (agent/agent.ts).
 * Currently only LocalRunner is supported (local Bun subprocess).
 */

export interface RunResult {
  /** Unique run identifier */
  runId: string;
  /** Final text output from the agent */
  output: string;
  /** Map of filename → content for files the agent produced */
  files: Record<string, string>;
}

export type StreamCallback = (chunk: string) => void;

/**
 * Extended stream callback that distinguishes between text output and tool events.
 * - "text": Agent's text response (stdout)
 * - "tool": Tool call indicators like [toolName] args... / [toolName] done (stderr)
 */
export type TypedStreamCallback = (chunk: string, type: "text" | "tool") => void;

export abstract class BaseRunner {
  /**
   * Run the agent with a given prompt.
   *
   * @param prompt - The user's prompt text
   * @param workflowId - Optional workflow ID for tracking
   * @param streamCallback - Optional callback for streaming output chunks
   * @param options - Optional additional options (e.g. threadId for conversation context)
   * @returns The completed run result
   */
  abstract run(
    prompt: string,
    workflowId?: string,
    streamCallback?: StreamCallback | TypedStreamCallback,
    options?: { threadId?: string }
  ): Promise<RunResult>;

  /**
   * Clean up any resources (sandbox, subprocess, etc.)
   */
  abstract kill(): Promise<void>;
}
