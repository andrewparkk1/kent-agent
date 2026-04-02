/**
 * Agent tools — re-exports all tool groups.
 *
 * Groups:
 *   1. Data Sources  — search/browse synced items
 *   2. Memories      — persistent knowledge base
 *   3. Workflows     — scheduled automation
 *   4. Filesystem    — files + shell commands
 */
import type { AgentTool } from "@mariozechner/pi-agent-core";
import { dataTools } from "./data.ts";
import { memoryTools } from "./memory.ts";
import { workflowTools } from "./workflow.ts";
import { filesystemTools } from "./filesystem.ts";
import { skillTools } from "./skills.ts";
export { dataTools } from "./data.ts";
export { memoryTools } from "./memory.ts";
export { workflowTools } from "./workflow.ts";
export { filesystemTools } from "./filesystem.ts";
export { skillTools } from "./skills.ts";

export const allTools: AgentTool[] = [
  ...dataTools,
  ...memoryTools,
  ...workflowTools,
  ...filesystemTools,
  ...skillTools,
];
