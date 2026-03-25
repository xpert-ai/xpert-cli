import { parsePatch } from "diff";
import { summarizeDiff } from "./diff.js";
import type { PendingTurnEntry, PendingTurnState } from "./history.js";
import type { ToolCompletionStatus } from "../runtime/turn-events.js";
import {
  stringDisplayWidth,
  truncateDisplayWidth,
} from "./display-width.js";

export type PendingToolCardStatus =
  | "running"
  | "waiting_permission"
  | ToolCompletionStatus;

export interface PendingViewLimits {
  maxAssistantChars: number;
  maxToolCards: number;
  maxBashBlocks: number;
  maxBashLinesPerBlock: number;
  maxDiffBlocks: number;
  maxDiffFilesPerBlock: number;
  maxDiffLinesPerFile: number;
  maxNoticeItems: number;
  maxLineChars: number;
}

export interface TextPreview {
  text: string;
  hiddenChars: number;
}

export interface PendingNoticeViewModel {
  key: string;
  message: string;
  toolName?: string;
  code?: string;
}

export interface PendingToolCardViewModel {
  key: string;
  callId?: string;
  toolName: string;
  target?: string;
  detail?: string;
  status: PendingToolCardStatus;
  summary?: string;
  activity?: string;
}

export interface PendingBashBlockViewModel {
  key: string;
  title: string;
  status: PendingToolCardStatus;
  summary?: string;
  lines: string[];
  hiddenLineCount: number;
}

export type DiffPreviewLineKind =
  | "hunk"
  | "add"
  | "remove"
  | "context"
  | "note";

export interface DiffPreviewLineViewModel {
  kind: DiffPreviewLineKind;
  text: string;
}

export interface DiffPreviewFileViewModel {
  path: string;
  lines: DiffPreviewLineViewModel[];
  hiddenLineCount: number;
}

export interface DiffPreviewBlockViewModel {
  key: string;
  title: string;
  status?: PendingToolCardStatus;
  summary?: string;
  files: DiffPreviewFileViewModel[];
  hiddenFileCount: number;
}

export interface PendingTurnViewModel {
  assistant?: TextPreview;
  reasoning?: TextPreview;
  toolCards: PendingToolCardViewModel[];
  hiddenToolCount: number;
  bashBlocks: PendingBashBlockViewModel[];
  hiddenBashBlockCount: number;
  diffBlocks: DiffPreviewBlockViewModel[];
  hiddenDiffBlockCount: number;
  warnings: PendingNoticeViewModel[];
  hiddenWarningCount: number;
  errors: PendingNoticeViewModel[];
  hiddenErrorCount: number;
}

interface ToolAggregate {
  key: string;
  order: number;
  callId?: string;
  toolName: string;
  target?: string;
  argsSummary?: string;
  status: PendingToolCardStatus;
  summary?: string;
  bashLines: string[];
  diffs: Array<{ path?: string; text: string }>;
  warningNotices: PendingNoticeViewModel[];
  errorNotices: PendingNoticeViewModel[];
  permissionSummary?: string;
}

export const DEFAULT_PENDING_VIEW_LIMITS: PendingViewLimits = {
  maxAssistantChars: 1200,
  maxToolCards: 4,
  maxBashBlocks: 3,
  maxBashLinesPerBlock: 6,
  maxDiffBlocks: 2,
  maxDiffFilesPerBlock: 2,
  maxDiffLinesPerFile: 10,
  maxNoticeItems: 4,
  maxLineChars: 140,
};

export function buildPendingTurnViewModel(
  pending: PendingTurnState,
  limits: Partial<PendingViewLimits> = {},
): PendingTurnViewModel {
  const resolvedLimits = {
    ...DEFAULT_PENDING_VIEW_LIMITS,
    ...limits,
  };
  const assistantSegments: string[] = [];
  const reasoningSegments: string[] = [];
  const warnings: PendingNoticeViewModel[] = [];
  const errors: PendingNoticeViewModel[] = [];
  const tools = new Map<string, ToolAggregate>();
  let toolSequence = 0;
  let lastToolKey: string | undefined;

  const ensureTool = (input: {
    key: string;
    callId?: string;
    toolName?: string;
    target?: string;
    argsSummary?: string;
  }): ToolAggregate => {
    const existing = tools.get(input.key);
    if (existing) {
      if (input.toolName) {
        existing.toolName = input.toolName;
      }
      if (input.target) {
        existing.target = input.target;
      }
      if (input.argsSummary) {
        existing.argsSummary = input.argsSummary;
      }
      if (input.callId) {
        existing.callId = input.callId;
      }
      return existing;
    }

    const tool: ToolAggregate = {
      key: input.key,
      order: toolSequence++,
      callId: input.callId,
      toolName: input.toolName ?? "Tool",
      target: input.target,
      argsSummary: input.argsSummary,
      status: "running",
      bashLines: [],
      diffs: [],
      warningNotices: [],
      errorNotices: [],
    };
    tools.set(input.key, tool);
    return tool;
  };

  const findLatestToolKeyByName = (toolName: string): string | undefined => {
    const matches = [...tools.values()].filter((tool) => tool.toolName === toolName);
    const latest = matches[matches.length - 1];
    return latest?.key;
  };

  const resolveToolKey = (
    entry: PendingTurnEntry,
    index: number,
    options?: {
      allowImplicitLastTool?: boolean;
    },
  ): string | undefined => {
    if ("callId" in entry && entry.callId) {
      return `call:${entry.callId}`;
    }

    if (entry.type === "tool_call" && entry.toolName) {
      return `entry:${index}:${entry.toolName}`;
    }

    if ("toolName" in entry && entry.toolName) {
      const existingKey = findLatestToolKeyByName(entry.toolName);
      if (existingKey) {
        return existingKey;
      }
      return `entry:${index}:${entry.toolName}`;
    }

    if (options?.allowImplicitLastTool) {
      return lastToolKey;
    }

    return undefined;
  };

  pending.entries.forEach((entry, index) => {
    switch (entry.type) {
      case "assistant_text":
        assistantSegments.push(entry.text);
        return;
      case "reasoning":
        reasoningSegments.push(entry.text);
        return;
      case "tool_call": {
        const key = resolveToolKey(entry, index) ?? `entry:${index}:tool`;
        const tool = ensureTool({
          key,
          callId: entry.callId,
          toolName: entry.toolName,
          target: entry.target,
          argsSummary: entry.argsSummary,
        });
        tool.status = "running";
        lastToolKey = key;
        return;
      }
      case "permission_requested": {
        const key = resolveToolKey(entry, index) ?? `entry:${index}:${entry.toolName}`;
        const tool = ensureTool({
          key,
          callId: entry.callId,
          toolName: entry.toolName,
          target: entry.target,
        });
        tool.status = "waiting_permission";
        tool.permissionSummary = `awaiting ${entry.riskLevel} approval`;
        lastToolKey = key;
        return;
      }
      case "permission_resolved": {
        const key = resolveToolKey(entry, index) ?? `entry:${index}:${entry.toolName}`;
        const tool = ensureTool({
          key,
          callId: entry.callId,
          toolName: entry.toolName,
          target: entry.target,
        });
        if (tool.status === "waiting_permission") {
          tool.status = entry.allowed ? "running" : "denied";
        }
        if (!entry.allowed) {
          tool.permissionSummary = entry.reason
            ? clipInline(entry.reason, resolvedLimits.maxLineChars)
            : "permission denied";
        }
        lastToolKey = key;
        return;
      }
      case "bash_line": {
        const key = resolveToolKey(entry, index, {
          allowImplicitLastTool: true,
        });
        if (!key) {
          return;
        }
        const tool = ensureTool({
          key,
          callId: entry.callId,
          toolName: entry.toolName,
        });
        tool.bashLines.push(entry.text);
        lastToolKey = key;
        return;
      }
      case "diff": {
        const key = resolveToolKey(entry, index, {
          allowImplicitLastTool: true,
        });
        if (!key) {
          return;
        }
        const tool = ensureTool({
          key,
          callId: entry.callId,
          toolName: entry.toolName,
        });
        tool.diffs.push({
          path: entry.path,
          text: entry.text,
        });
        lastToolKey = key;
        return;
      }
      case "tool_result": {
        const key = resolveToolKey(entry, index) ?? `entry:${index}:${entry.toolName}`;
        const tool = ensureTool({
          key,
          callId: entry.callId,
          toolName: entry.toolName,
        });
        tool.status = entry.status;
        tool.summary = entry.summary;
        lastToolKey = key;
        return;
      }
      case "warning": {
        const notice = {
          key: `${entry.callId ?? "warning"}:${entry.code ?? ""}:${index}`,
          message: entry.text,
          toolName: entry.toolName,
          code: entry.code,
        };
        warnings.push(notice);
        const key = resolveToolKey(entry, index);
        if (key) {
          const tool = ensureTool({
            key,
            callId: entry.callId,
            toolName: entry.toolName,
          });
          tool.warningNotices.push(notice);
          lastToolKey = key;
        }
        return;
      }
      case "error": {
        const notice = {
          key: `${entry.callId ?? "error"}:${entry.code ?? ""}:${index}`,
          message: entry.text,
          toolName: entry.toolName,
          code: entry.code,
        };
        errors.push(notice);
        const key = resolveToolKey(entry, index);
        if (key) {
          const tool = ensureTool({
            key,
            callId: entry.callId,
            toolName: entry.toolName,
          });
          tool.errorNotices.push(notice);
          lastToolKey = key;
        }
      }
    }
  });

  const toolList = [...tools.values()].sort((left, right) => left.order - right.order);
  const visibleTools = tail(toolList, resolvedLimits.maxToolCards);
  const bashTools = tail(
    toolList.filter((tool) => tool.bashLines.length > 0),
    resolvedLimits.maxBashBlocks,
  );
  const diffTools = tail(
    toolList.filter((tool) => tool.diffs.length > 0),
    resolvedLimits.maxDiffBlocks,
  );
  const dedupedWarnings = dedupeNotices(warnings);
  const dedupedErrors = dedupeNotices(errors);
  const visibleWarnings = tail(dedupedWarnings, resolvedLimits.maxNoticeItems);
  const visibleErrors = tail(dedupedErrors, resolvedLimits.maxNoticeItems);

  return {
    assistant: buildTextPreview(assistantSegments, resolvedLimits.maxAssistantChars),
    reasoning: buildTextPreview(reasoningSegments, resolvedLimits.maxAssistantChars),
    toolCards: visibleTools.map((tool) => buildToolCardViewModel(tool, resolvedLimits)),
    hiddenToolCount: Math.max(0, toolList.length - visibleTools.length),
    bashBlocks: bashTools.map((tool) => buildBashBlockViewModel(tool, resolvedLimits)),
    hiddenBashBlockCount: Math.max(0, toolList.filter((tool) => tool.bashLines.length > 0).length - bashTools.length),
    diffBlocks: diffTools.map((tool) => buildDiffBlockViewModel(tool, resolvedLimits)),
    hiddenDiffBlockCount: Math.max(0, toolList.filter((tool) => tool.diffs.length > 0).length - diffTools.length),
    warnings: visibleWarnings.map((notice, index) => ({
      ...notice,
      key: `${notice.key}:warning:${index}`,
      message: clipInline(notice.message, resolvedLimits.maxLineChars),
    })),
    hiddenWarningCount: Math.max(0, dedupedWarnings.length - visibleWarnings.length),
    errors: visibleErrors.map((notice, index) => ({
      ...notice,
      key: `${notice.key}:error:${index}`,
      message: clipInline(notice.message, resolvedLimits.maxLineChars),
    })),
    hiddenErrorCount: Math.max(0, dedupedErrors.length - visibleErrors.length),
  };
}

export function buildDiffPreview(
  diffText: string,
  options: {
    path?: string;
    maxFiles?: number;
    maxLinesPerFile?: number;
    maxLineChars?: number;
  } = {},
): Pick<DiffPreviewBlockViewModel, "files" | "hiddenFileCount"> {
  const maxFiles = options.maxFiles ?? DEFAULT_PENDING_VIEW_LIMITS.maxDiffFilesPerBlock;
  const maxLinesPerFile =
    options.maxLinesPerFile ?? DEFAULT_PENDING_VIEW_LIMITS.maxDiffLinesPerFile;
  const maxLineChars = options.maxLineChars ?? DEFAULT_PENDING_VIEW_LIMITS.maxLineChars;

  try {
    const patches = parsePatch(diffText);
    if (patches.length === 0) {
      return {
        files: buildFallbackDiffFiles(diffText, options.path, maxLinesPerFile, maxLineChars),
        hiddenFileCount: 0,
      };
    }

    const visiblePatches = patches.slice(0, maxFiles);
    return {
      files: visiblePatches.map((patch, index) => {
        const path = normalizeDiffPath(
          options.path,
          patch.newFileName,
          patch.oldFileName,
          index,
        );
        const rawLines: DiffPreviewLineViewModel[] = [];
        for (const hunk of patch.hunks) {
          rawLines.push({
            kind: "hunk",
            text: clipDisplayLine(formatHunkHeader(hunk), maxLineChars),
          });
          for (const line of hunk.lines) {
            rawLines.push({
              kind: getDiffLineKind(line),
              text: clipDisplayLine(line, maxLineChars),
            });
          }
        }

        const visibleLines = rawLines.slice(0, maxLinesPerFile);
        return {
          path,
          lines: visibleLines,
          hiddenLineCount: Math.max(0, rawLines.length - visibleLines.length),
        };
      }),
      hiddenFileCount: Math.max(0, patches.length - visiblePatches.length),
    };
  } catch {
    return {
      files: buildFallbackDiffFiles(diffText, options.path, maxLinesPerFile, maxLineChars),
      hiddenFileCount: 0,
    };
  }
}

function buildToolCardViewModel(
  tool: ToolAggregate,
  limits: PendingViewLimits,
): PendingToolCardViewModel {
  const activityParts: string[] = [];
  if (tool.bashLines.length > 0) {
    activityParts.push(`${tool.bashLines.length} bash line${tool.bashLines.length === 1 ? "" : "s"}`);
  }
  if (tool.diffs.length > 0) {
    activityParts.push(`${tool.diffs.length} diff block${tool.diffs.length === 1 ? "" : "s"}`);
  }
  if (tool.warningNotices.length > 0) {
    activityParts.push(`${tool.warningNotices.length} warn`);
  }
  if (tool.errorNotices.length > 0) {
    activityParts.push(`${tool.errorNotices.length} error`);
  }

  return {
    key: tool.key,
    callId: tool.callId,
    toolName: tool.toolName,
    target: tool.target ? clipInline(tool.target, limits.maxLineChars) : undefined,
    detail:
      tool.argsSummary && tool.argsSummary !== tool.target
        ? clipInline(tool.argsSummary, limits.maxLineChars)
        : undefined,
    status: tool.status,
    summary: clipInline(resolveToolSummary(tool), limits.maxLineChars),
    activity: activityParts.length > 0 ? activityParts.join(" · ") : undefined,
  };
}

function buildBashBlockViewModel(
  tool: ToolAggregate,
  limits: PendingViewLimits,
): PendingBashBlockViewModel {
  const visibleLines = tail(tool.bashLines, limits.maxBashLinesPerBlock).map((line) =>
    clipDisplayLine(line, limits.maxLineChars),
  );
  return {
    key: `${tool.key}:bash`,
    title: formatToolTitle(tool.toolName, tool.target),
    status: tool.status,
    summary: tool.summary ? clipInline(tool.summary, limits.maxLineChars) : undefined,
    lines: visibleLines,
    hiddenLineCount: Math.max(0, tool.bashLines.length - visibleLines.length),
  };
}

function buildDiffBlockViewModel(
  tool: ToolAggregate,
  limits: PendingViewLimits,
): DiffPreviewBlockViewModel {
  const files: DiffPreviewFileViewModel[] = [];
  let hiddenFileCount = 0;
  let remainingFiles = limits.maxDiffFilesPerBlock;

  for (const diff of tool.diffs) {
    if (remainingFiles <= 0) {
      hiddenFileCount += 1;
      continue;
    }
    const preview = buildDiffPreview(diff.text, {
      path: diff.path,
      maxFiles: remainingFiles,
      maxLinesPerFile: limits.maxDiffLinesPerFile,
      maxLineChars: limits.maxLineChars,
    });
    files.push(...preview.files);
    remainingFiles = Math.max(0, remainingFiles - preview.files.length);
    hiddenFileCount += preview.hiddenFileCount;
  }

  return {
    key: `${tool.key}:diff`,
    title: formatToolTitle(tool.toolName, tool.target),
    status: tool.status,
    summary: clipInline(tool.summary ?? summarizeDiff(tool.diffs[0]?.text ?? ""), limits.maxLineChars),
    files,
    hiddenFileCount,
  };
}

function resolveToolSummary(tool: ToolAggregate): string {
  if (tool.summary) {
    return tool.summary;
  }

  if (tool.errorNotices.length > 0) {
    return tool.errorNotices[tool.errorNotices.length - 1]?.message ?? "tool failed";
  }

  if (tool.warningNotices.length > 0) {
    return tool.warningNotices[tool.warningNotices.length - 1]?.message ?? "tool warning";
  }

  if (tool.permissionSummary) {
    return tool.permissionSummary;
  }

  if (tool.argsSummary) {
    return tool.argsSummary;
  }

  return "running";
}

function buildTextPreview(
  segments: string[],
  maxChars: number,
): TextPreview | undefined {
  if (segments.length === 0) {
    return undefined;
  }

  const joined = segments.join("");
  if (joined.length === 0) {
    return undefined;
  }

  const displayWidth = stringDisplayWidth(joined);
  if (displayWidth <= maxChars) {
    return {
      text: joined,
      hiddenChars: 0,
    };
  }

  return {
    text: truncateDisplayWidth(joined, maxChars, {
      position: "start",
    }),
    hiddenChars: Math.max(0, displayWidth - maxChars),
  };
}

function buildFallbackDiffFiles(
  diffText: string,
  explicitPath: string | undefined,
  maxLinesPerFile: number,
  maxLineChars: number,
): DiffPreviewFileViewModel[] {
  const lines = diffText
    .split("\n")
    .filter((line) => line.length > 0)
    .slice(0, maxLinesPerFile)
    .map((line) => ({
      kind: getDiffLineKind(line),
      text: clipDisplayLine(line, maxLineChars),
    }));

  return [
    {
      path: explicitPath ?? "(diff)",
      lines,
      hiddenLineCount: Math.max(0, diffText.split("\n").filter(Boolean).length - lines.length),
    },
  ];
}

function normalizeDiffPath(
  explicitPath: string | undefined,
  newFileName: string | undefined,
  oldFileName: string | undefined,
  index: number,
): string {
  const candidate = [explicitPath, newFileName, oldFileName]
    .map((value) => value?.trim())
    .find((value) => value && value !== "/dev/null");

  return candidate ?? `diff-${index + 1}`;
}

function formatHunkHeader(hunk: {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
}): string {
  return `@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@`;
}

function getDiffLineKind(line: string): DiffPreviewLineKind {
  if (line.startsWith("@@")) {
    return "hunk";
  }
  if (line.startsWith("+")) {
    return "add";
  }
  if (line.startsWith("-")) {
    return "remove";
  }
  if (line.startsWith("\\")) {
    return "note";
  }
  return "context";
}

function formatToolTitle(toolName: string, target?: string): string {
  return target ? `${toolName} · ${target}` : toolName;
}

function dedupeNotices(notices: PendingNoticeViewModel[]): PendingNoticeViewModel[] {
  const seen = new Set<string>();
  const unique: PendingNoticeViewModel[] = [];

  for (let index = notices.length - 1; index >= 0; index -= 1) {
    const notice = notices[index];
    if (!notice) {
      continue;
    }
    const key = `${notice.toolName ?? ""}:${notice.code ?? ""}:${notice.message}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    unique.unshift(notice);
  }

  return unique;
}

function tail<T>(items: T[], count: number): T[] {
  if (items.length <= count) {
    return items;
  }

  return items.slice(-count);
}

export function clipInline(value: string, maxChars: number): string {
  return truncateDisplayWidth(
    value.replace(/\s+/g, " ").trim(),
    Math.max(1, maxChars),
  );
}

function clipDisplayLine(value: string, maxChars: number): string {
  return truncateDisplayWidth(
    value.replace(/\t/g, "    "),
    Math.max(1, maxChars),
  );
}
