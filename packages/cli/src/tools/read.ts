import type { ToolDefinition } from "./contracts.js";

export const readTool: ToolDefinition<{
  path: string;
  offset?: number;
  limit?: number;
}> = {
  name: "Read",
  description: "Read a file from the local project with line numbers.",
  schema: {
    type: "object",
    properties: {
      path: { type: "string", description: "Path relative to the project root." },
      offset: { type: "number", minimum: 1 },
      limit: { type: "number", minimum: 1, maximum: 400 },
    },
    required: ["path"],
  },
  async execute(args, context) {
    const content = await context.backend.readFile(args.path, {
      offset: args.offset,
      limit: args.limit,
    });
    return {
      summary: `read ${args.path}`,
      content: content || "(empty file or no content in requested range)",
    };
  },
};
