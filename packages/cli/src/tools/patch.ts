import { summarizeDiff } from "../ui/diff.js";
import type { ToolDefinition } from "./contracts.js";

export const patchTool: ToolDefinition<{
  path: string;
  oldString: string;
  newString: string;
  replaceAll?: boolean;
}> = {
  name: "Patch",
  description: "Apply an exact string patch to a file in the local project.",
  schema: {
    type: "object",
    properties: {
      path: { type: "string" },
      oldString: { type: "string" },
      newString: { type: "string" },
      replaceAll: { type: "boolean" },
    },
    required: ["path", "oldString", "newString"],
  },
  async execute(args, context) {
    const result = await context.backend.patchFile(args);
    context.ui.printDiff(result.diff);
    return {
      summary: `${args.path} ${summarizeDiff(result.diff)}`,
      content: `Patched ${args.path}. Replacements: ${result.occurrences}.`,
      artifact: { diff: result.diff, occurrences: result.occurrences },
      changedFiles: [args.path],
    };
  },
};
