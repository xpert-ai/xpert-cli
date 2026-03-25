import type { InspectorPanelData } from "./commands.js";
import type { PendingTurnState, UiHistoryItem } from "./history.js";
import {
  buildDiffPreview,
  buildPendingTurnViewModel,
  type DiffPreviewFileViewModel,
  type PendingToolCardStatus,
} from "./pending-view.js";
import type { ToolCompletionStatus } from "../runtime/turn-events.js";

export type UiBlockStatus =
  | "idle"
  | "running"
  | "waiting_permission"
  | ToolCompletionStatus;

export type UiNoticeScope = "tool" | "session";
export type UiNoticeLevel = "info" | "warning" | "error";

interface UiRenderBlockBase {
  id: string;
  pending?: boolean;
}

export interface UiInfoBlock extends UiRenderBlockBase {
  kind: "info";
  text: string;
}

export interface UiUserMessageBlock extends UiRenderBlockBase {
  kind: "user_message";
  text: string;
}

export interface UiAssistantMessageBlock extends UiRenderBlockBase {
  kind: "assistant_message";
  text: string;
}

export interface UiThinkingBlock extends UiRenderBlockBase {
  kind: "thinking";
  text: string;
}

export interface UiToolGroupBlock extends UiRenderBlockBase {
  kind: "tool_group";
  toolName: string;
  target?: string;
  detail?: string;
  status: UiBlockStatus;
  summary?: string;
  activity?: string;
}

export interface UiBashOutputBlock extends UiRenderBlockBase {
  kind: "bash_output";
  title: string;
  status: UiBlockStatus;
  summary?: string;
  lines: string[];
  hiddenLineCount: number;
}

export interface UiDiffPreviewBlock extends UiRenderBlockBase {
  kind: "diff_preview";
  title: string;
  status?: UiBlockStatus;
  summary?: string;
  files: DiffPreviewFileViewModel[];
  hiddenFileCount: number;
}

export interface UiNoticeBlock extends UiRenderBlockBase {
  kind: "notice";
  level: UiNoticeLevel;
  scope: UiNoticeScope;
  title: string;
  code?: string;
  messages: string[];
}

export interface UiSectionBlock extends UiRenderBlockBase {
  kind: "section";
  title: string;
  lines: string[];
}

export type UiRenderBlock =
  | UiInfoBlock
  | UiUserMessageBlock
  | UiAssistantMessageBlock
  | UiThinkingBlock
  | UiToolGroupBlock
  | UiBashOutputBlock
  | UiDiffPreviewBlock
  | UiNoticeBlock
  | UiSectionBlock;

export interface CommittedRenderBatch {
  id: string;
  blocks: UiRenderBlock[];
}

interface MutableHistoryToolBlock {
  block: UiToolGroupBlock;
  bashBlock?: UiBashOutputBlock;
  diffBlock?: UiDiffPreviewBlock;
  bashLines: number;
  diffCount: number;
  warningCount: number;
  errorCount: number;
}

export function buildHistoryRenderBlocks(history: UiHistoryItem[]): UiRenderBlock[] {
  const blocks: UiRenderBlock[] = [];
  const tools = new Map<string, MutableHistoryToolBlock>();

  const ensureTool = (input: {
    key: string;
    toolName: string;
    target?: string;
    detail?: string;
  }): MutableHistoryToolBlock => {
    const existing = tools.get(input.key);
    if (existing) {
      if (input.target) {
        existing.block.target = input.target;
      }
      if (input.detail) {
        existing.block.detail = input.detail;
      }
      return existing;
    }

    const block: UiToolGroupBlock = {
      id: input.key,
      kind: "tool_group",
      toolName: input.toolName,
      target: input.target,
      detail: input.detail,
      status: "running",
    };
    const aggregate: MutableHistoryToolBlock = {
      block,
      bashLines: 0,
      diffCount: 0,
      warningCount: 0,
      errorCount: 0,
    };
    tools.set(input.key, aggregate);
    blocks.push(block);
    return aggregate;
  };

  history.forEach((item, index) => {
    switch (item.type) {
      case "info":
        blocks.push({
          id: item.id,
          kind: "info",
          text: item.text,
        });
        return;
      case "user_prompt":
        blocks.push({
          id: item.id,
          kind: "user_message",
          text: item.text,
        });
        return;
      case "assistant_text":
        blocks.push({
          id: item.id,
          kind: "assistant_message",
          text: item.text,
        });
        return;
      case "reasoning":
        blocks.push({
          id: item.id,
          kind: "thinking",
          text: item.text,
        });
        return;
      case "tool_call": {
        const key = resolveToolKey(item.callId, item.toolName, index);
        ensureTool({
          key,
          toolName: item.toolName,
          target: item.target,
          detail:
            item.argsSummary && item.argsSummary !== item.target
              ? item.argsSummary
              : undefined,
        });
        return;
      }
      case "tool_result": {
        const key = resolveToolKey(item.callId, item.toolName, index);
        const aggregate = ensureTool({
          key,
          toolName: item.toolName,
        });
        aggregate.block.status = item.status;
        aggregate.block.summary = item.summary;
        return;
      }
      case "bash_line": {
        const key = resolveToolKey(item.callId, item.toolName ?? "Bash", index);
        const aggregate = ensureTool({
          key,
          toolName: item.toolName ?? "Bash",
        });
        if (!aggregate.bashBlock) {
          aggregate.bashBlock = {
            id: `${key}:bash`,
            kind: "bash_output",
            title: formatToolTitle(item.toolName ?? "Bash", aggregate.block.target),
            status: aggregate.block.status,
            lines: [],
            hiddenLineCount: 0,
          };
          blocks.push(aggregate.bashBlock);
        }
        aggregate.bashBlock.status = aggregate.block.status;
        aggregate.bashBlock.lines.push(item.text);
        aggregate.bashLines += 1;
        return;
      }
      case "diff": {
        const key = resolveToolKey(item.callId, item.toolName ?? "Patch", index);
        const aggregate = ensureTool({
          key,
          toolName: item.toolName ?? "Patch",
          target: item.path ?? aggregateToolTarget(tools.get(key)),
        });
        const preview = buildDiffPreview(item.text, {
          path: item.path,
        });
        if (!aggregate.diffBlock) {
          aggregate.diffBlock = {
            id: `${key}:diff`,
            kind: "diff_preview",
            title: formatToolTitle(item.toolName ?? "Diff", item.path ?? aggregate.block.target),
            status: aggregate.block.status,
            files: [],
            hiddenFileCount: 0,
          };
          blocks.push(aggregate.diffBlock);
        }
        aggregate.diffBlock.status = aggregate.block.status;
        aggregate.diffBlock.summary ??= summarizeDiffPreview(preview);
        aggregate.diffBlock.files.push(...preview.files);
        aggregate.diffBlock.hiddenFileCount += preview.hiddenFileCount;
        aggregate.diffCount += 1;
        return;
      }
      case "warning":
      case "error": {
        const level = item.type;
        const key = item.toolName
          ? resolveToolKey(item.callId, item.toolName, index)
          : `notice:${item.id}`;
        const aggregate = item.toolName ? tools.get(key) : undefined;
        if (aggregate) {
          if (level === "warning") {
            aggregate.warningCount += 1;
          } else {
            aggregate.errorCount += 1;
          }
        }
        blocks.push({
          id: item.id,
          kind: "notice",
          level,
          scope: item.callId || item.toolName ? "tool" : "session",
          title: buildNoticeTitle({
            level,
            scope: item.callId || item.toolName ? "tool" : "session",
            toolName: item.toolName,
          }),
          code: item.code,
          messages: [item.text],
        });
        return;
      }
      case "status_view":
      case "tools_view":
      case "session_view":
        blocks.push({
          id: item.id,
          kind: "section",
          title: item.title,
          lines: item.lines,
        });
        return;
    }
  });

  for (const aggregate of tools.values()) {
    const activity: string[] = [];
    if (aggregate.bashLines > 0) {
      activity.push(
        `${aggregate.bashLines} bash line${aggregate.bashLines === 1 ? "" : "s"}`,
      );
    }
    if (aggregate.diffCount > 0) {
      activity.push(
        `${aggregate.diffCount} diff block${aggregate.diffCount === 1 ? "" : "s"}`,
      );
    }
    if (aggregate.warningCount > 0) {
      activity.push(
        `${aggregate.warningCount} warning${aggregate.warningCount === 1 ? "" : "s"}`,
      );
    }
    if (aggregate.errorCount > 0) {
      activity.push(
        `${aggregate.errorCount} error${aggregate.errorCount === 1 ? "" : "s"}`,
      );
    }
    aggregate.block.activity = activity.length > 0 ? activity.join(" | ") : undefined;
    if (aggregate.bashBlock) {
      aggregate.bashBlock.summary ??= aggregate.block.summary;
      aggregate.bashBlock.status = aggregate.block.status;
    }
    if (aggregate.diffBlock) {
      aggregate.diffBlock.summary ??= aggregate.block.summary;
      aggregate.diffBlock.status = aggregate.block.status;
    }
  }

  return blocks;
}

export function createCommittedRenderBatch(
  history: UiHistoryItem[],
): CommittedRenderBatch | null {
  if (history.length === 0) {
    return null;
  }

  const blocks = buildHistoryRenderBlocks(history);
  if (blocks.length === 0) {
    return null;
  }

  return {
    id: `batch:${history[0]?.id ?? "history"}`,
    blocks,
  };
}

export function buildPendingRenderBlocks(
  pending: PendingTurnState,
): UiRenderBlock[] {
  if (pending.entries.length === 0) {
    return [];
  }

  const viewModel = buildPendingTurnViewModel(pending);
  const blocks: UiRenderBlock[] = [];

  if (viewModel.assistant) {
    blocks.push({
      id: "pending:assistant",
      kind: "assistant_message",
      text: viewModel.assistant.text,
      pending: true,
    });
  }

  if (viewModel.reasoning) {
    blocks.push({
      id: "pending:thinking",
      kind: "thinking",
      text: viewModel.reasoning.text,
      pending: true,
    });
  }

  for (const tool of viewModel.toolCards) {
    blocks.push({
      id: tool.key,
      kind: "tool_group",
      toolName: tool.toolName,
      target: tool.target,
      detail: tool.detail,
      status: tool.status,
      summary: tool.summary,
      activity: tool.activity,
      pending: true,
    });
  }

  for (const bash of viewModel.bashBlocks) {
    blocks.push({
      id: bash.key,
      kind: "bash_output",
      title: bash.title,
      status: bash.status,
      summary: bash.summary,
      lines: bash.lines,
      hiddenLineCount: bash.hiddenLineCount,
      pending: true,
    });
  }

  for (const diff of viewModel.diffBlocks) {
    blocks.push({
      id: diff.key,
      kind: "diff_preview",
      title: diff.title,
      status: diff.status,
      summary: diff.summary,
      files: diff.files,
      hiddenFileCount: diff.hiddenFileCount,
      pending: true,
    });
  }

  const notices = buildPendingNoticeBlocks(pending);
  for (const notice of notices) {
    blocks.push({
      ...notice,
      pending: true,
    });
  }

  return blocks;
}

export function buildOverlayRenderBlocks(
  data: InspectorPanelData,
): UiRenderBlock[] {
  return data.sections.map((section, index) => ({
    id: `${data.panel}:${index}`,
    kind: "section",
    title: section.title,
    lines: section.lines,
  }));
}

function buildPendingNoticeBlocks(
  pending: PendingTurnState,
): UiNoticeBlock[] {
  const blocks: UiNoticeBlock[] = [];

  pending.entries.forEach((entry, index) => {
    if (entry.type !== "warning" && entry.type !== "error") {
      return;
    }

    const scope: UiNoticeScope = entry.callId || entry.toolName ? "tool" : "session";
    blocks.push({
      id: `pending:notice:${index}`,
      kind: "notice",
      level: entry.type,
      scope,
      title: buildNoticeTitle({
        level: entry.type,
        scope,
        toolName: entry.toolName,
      }),
      code: entry.code,
      messages: [entry.text],
    });
  });

  return blocks;
}

function resolveToolKey(
  callId: string | undefined,
  toolName: string,
  index: number,
): string {
  if (callId) {
    return `call:${callId}`;
  }

  return `tool:${toolName}:${index}`;
}

function aggregateToolTarget(
  aggregate: MutableHistoryToolBlock | undefined,
): string | undefined {
  return aggregate?.block.target;
}

function formatToolTitle(toolName: string, target?: string): string {
  return target ? `${toolName} · ${target}` : toolName;
}

function buildNoticeTitle(input: {
  level: UiNoticeLevel;
  scope: UiNoticeScope;
  toolName?: string;
}): string {
  const subject =
    input.scope === "tool" ? input.toolName ?? "Tool" : "Session";
  const level =
    input.level === "warning"
      ? "Warning"
      : input.level === "error"
        ? "Error"
        : "Notice";

  return `${subject} ${level}`;
}

function summarizeDiffPreview(input: {
  files: DiffPreviewFileViewModel[];
  hiddenFileCount: number;
}): string | undefined {
  const visibleCount = input.files.length;
  const totalFiles = visibleCount + input.hiddenFileCount;
  if (totalFiles === 0) {
    return undefined;
  }
  return `${totalFiles} file${totalFiles === 1 ? "" : "s"}`;
}
