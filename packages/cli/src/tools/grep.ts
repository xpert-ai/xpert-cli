import type { ToolDefinition } from "./contracts.js";

export const grepTool: ToolDefinition<{
  pattern: string;
  searchPath?: string;
  glob?: string;
}> = {
  name: "Grep",
  description: "Search file contents in the local project with ripgrep.",
  schema: {
    type: "object",
    properties: {
      pattern: { type: "string" },
      searchPath: { type: "string" },
      glob: { type: "string" },
    },
    required: ["pattern"],
  },
  async execute(args, context) {
    const content = await context.backend.grep(args.pattern, args.searchPath, args.glob);
    return {
      summary: content ? "matches found" : "no matches",
      content: content || "No matches found.",
    };
  },
};
