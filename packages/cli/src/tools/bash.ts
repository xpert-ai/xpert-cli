import type { ToolDefinition } from "./contracts.js";

export const bashTool: ToolDefinition<{
  command: string;
  cwd?: string;
  timeoutMs?: number;
}> = {
  name: "Bash",
  description: "Run a shell command on the local machine inside the project root.",
  schema: {
    type: "object",
    properties: {
      command: { type: "string" },
      cwd: { type: "string" },
      timeoutMs: { type: "number", minimum: 1 },
    },
    required: ["command"],
  },
  async execute(args, context) {
    const result = await context.backend.exec(args.command, {
      cwd: args.cwd ?? context.cwd,
      timeoutMs: args.timeoutMs,
      onLine: (line) => context.ui.showBashLine(line),
      signal: context.signal,
    });

    const content = [
      `Command: ${args.command}`,
      `Exit code: ${result.exitCode ?? "null"}`,
      ...(result.timedOut ? ["Timed out: true"] : []),
      ...(result.output ? ["", result.output] : []),
    ]
      .filter(Boolean)
      .join("\n");

    return {
      summary: `exit ${result.exitCode ?? "null"}`,
      content,
    };
  },
};
