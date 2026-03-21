import { summarizeDiff } from "../ui/diff.js";
import type { ToolDefinition } from "./contracts.js";

export const writeTool: ToolDefinition<{
  path: string;
  content: string;
}> = {
  name: "Write",
  description:
    "Create a new file in the local project. Fails if the file already exists; use Patch to modify existing files.",
  schema: {
    type: "object",
    properties: {
      path: { type: "string", description: "Path relative to the project root." },
      content: {
        type: "string",
        description: "Complete content for the new file.",
      },
    },
    required: ["path", "content"],
  },
  async execute(args, context) {
    const result = await context.backend.writeFile(args);
    context.ui.printDiff(result.diff);
    return {
      summary: `${result.path} ${summarizeDiff(result.diff)}`,
      content: `Created ${result.path}.`,
      artifact: { diff: result.diff },
      changedFiles: [result.path],
    };
  },
};
