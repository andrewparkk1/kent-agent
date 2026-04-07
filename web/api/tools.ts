/** GET /api/tools — return agent tool metadata grouped by category. */
import { dataTools } from "../../agent/tools/data.ts";
import { memoryTools } from "../../agent/tools/memory.ts";
import { workflowTools } from "../../agent/tools/workflow.ts";
import { filesystemTools } from "../../agent/tools/filesystem.ts";
import { skillTools } from "../../agent/tools/skills.ts";

interface ToolMeta {
  name: string;
  description: string;
}

interface ToolCategory {
  category: string;
  tools: ToolMeta[];
}

function extract(tools: any[]): ToolMeta[] {
  return tools.map((t) => ({ name: t.name, description: t.description }));
}

export function handleTools() {
  const categories: ToolCategory[] = [
    { category: "Data Sources", tools: extract(dataTools) },
    { category: "Memories", tools: extract(memoryTools) },
    { category: "Workflows", tools: extract(workflowTools) },
    { category: "Filesystem", tools: extract(filesystemTools) },
    { category: "Skills", tools: extract(skillTools) },
  ];
  return Response.json({ categories });
}
