/**
 * Base runner interface and abstract class.
 *
 * Runners execute the agent (agent/agent.ts) in different environments:
 * - E2BRunner: sandboxed cloud environment via E2B
 * - LocalRunner: local Bun subprocess with filesystem access
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

export abstract class BaseRunner {
  /**
   * Run the agent with a given prompt.
   *
   * @param prompt - The user's prompt text
   * @param workflowId - Optional workflow ID for tracking
   * @param streamCallback - Optional callback for streaming output chunks
   * @returns The completed run result
   */
  abstract run(
    prompt: string,
    workflowId?: string,
    streamCallback?: StreamCallback
  ): Promise<RunResult>;

  /**
   * Clean up any resources (sandbox, subprocess, etc.)
   */
  abstract kill(): Promise<void>;
}
