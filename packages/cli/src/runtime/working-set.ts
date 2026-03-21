import type { ToolCallSummary } from "@xpert-cli/contracts";

const MAX_RECENT_FILES = 20;
const MAX_TOOL_SUMMARIES = 50;

export function pushRecentFile(current: string[], filePath: string): string[] {
  const next = [filePath, ...current.filter((item) => item !== filePath)];
  return next.slice(0, MAX_RECENT_FILES);
}

export function pushToolSummary(
  current: ToolCallSummary[],
  summary: ToolCallSummary,
): ToolCallSummary[] {
  return [summary, ...current].slice(0, MAX_TOOL_SUMMARIES);
}
