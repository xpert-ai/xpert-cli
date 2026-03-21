import type { ToolRegistry } from "./contracts.js";
import { bashTool } from "./bash.js";
import { gitDiffTool, gitStatusTool } from "./git.js";
import { globTool } from "./glob.js";
import { grepTool } from "./grep.js";
import { patchTool } from "./patch.js";
import { readTool } from "./read.js";
import { writeTool } from "./write.js";

export function createToolRegistry(): ToolRegistry {
  const tools = [
    readTool,
    globTool,
    grepTool,
    writeTool,
    patchTool,
    bashTool,
    gitStatusTool,
    gitDiffTool,
  ];

  return {
    tools: new Map(tools.map((tool) => [tool.name, tool])),
    clientTools: tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      schema: tool.schema,
    })),
  };
}
