import type { ToolDefinition } from "./contracts.js";

export const gitStatusTool: ToolDefinition<{ cwd?: string }> = {
  name: "GitStatus",
  description: "Show local git status for the current project.",
  schema: {
    type: "object",
    properties: {
      cwd: { type: "string" },
    },
  },
  async execute(args, context) {
    const result = await context.backend.exec("git status --short --branch", {
      cwd: args.cwd ?? context.cwd,
    });
    return {
      summary: `exit ${result.exitCode ?? "null"}`,
      content: result.output || "(no git output)",
    };
  },
};

export const gitDiffTool: ToolDefinition<{ path?: string; staged?: boolean; cwd?: string }> = {
  name: "GitDiff",
  description: "Show git diff for the current project or a specific path.",
  schema: {
    type: "object",
    properties: {
      path: { type: "string" },
      staged: { type: "boolean" },
      cwd: { type: "string" },
    },
  },
  async execute(args, context) {
    const staged = args.staged ? "--staged " : "";
    const target = args.path ? ` -- ${args.path}` : "";
    const result = await context.backend.exec(`git diff ${staged}${target}`.trim(), {
      cwd: args.cwd ?? context.cwd,
    });
    return {
      summary: `exit ${result.exitCode ?? "null"}`,
      content: result.output || "(no diff)",
    };
  },
};
