import type { ToolDefinition } from "./contracts.js";

export const globTool: ToolDefinition<{
  pattern: string;
  searchPath?: string;
}> = {
  name: "Glob",
  description: "Find files in the local project using a glob pattern.",
  schema: {
    type: "object",
    properties: {
      pattern: { type: "string" },
      searchPath: { type: "string" },
    },
    required: ["pattern"],
  },
  async execute(args, context) {
    const matches = await context.backend.glob(args.pattern, args.searchPath);
    return {
      summary: `${matches.length} match(es)`,
      content: matches.length ? matches.join("\n") : "No files matched.",
    };
  },
};
