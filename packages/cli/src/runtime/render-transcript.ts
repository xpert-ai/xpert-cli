import type { UiHistoryItem } from "../ui/history.js";
import type { ToolCompletionStatus } from "./turn-events.js";

export const RENDER_TRANSCRIPT_LIMITS = {
  maxReplayTurns: 8,
  maxItemsPerTurn: 80,
  userPromptChars: 1_200,
  assistantChars: 2_000,
  reasoningChars: 1_200,
  toolNameChars: 80,
  targetChars: 220,
  argsSummaryChars: 220,
  toolSummaryChars: 280,
  bashLinesPerTurn: 40,
  bashLineChars: 240,
  diffBlocksPerTurn: 8,
  diffChars: 4_000,
  pathChars: 220,
  warningCountPerTurn: 12,
  errorCountPerTurn: 12,
  noticeChars: 400,
} as const;

interface ToolCallRenderItemBase {
  callId?: string;
  toolName: string;
  target?: string;
  argsSummary?: string;
}

interface ToolNoticeRenderItemBase {
  callId?: string;
  toolName?: string;
  code?: string;
  text: string;
}

export type PersistedTurnRenderItem =
  | { type: "user_prompt"; text: string }
  | { type: "assistant_text"; text: string }
  | { type: "reasoning"; text: string }
  | ({ type: "tool_call" } & ToolCallRenderItemBase)
  | {
      type: "tool_result";
      callId?: string;
      toolName: string;
      summary: string;
      status: ToolCompletionStatus;
    }
  | { type: "bash_line"; callId?: string; toolName?: string; text: string }
  | { type: "diff"; callId?: string; toolName?: string; path?: string; text: string }
  | ({ type: "warning" } & ToolNoticeRenderItemBase)
  | ({ type: "error" } & ToolNoticeRenderItemBase);

export function sanitizePersistedTurnRenderItems(
  value: unknown,
): PersistedTurnRenderItem[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const items: PersistedTurnRenderItem[] = [];
  const notices = new Set<string>();
  let bashLines = 0;
  let diffBlocks = 0;
  let warningCount = 0;
  let errorCount = 0;
  let itemLimitReached = false;

  for (const rawItem of value) {
    const item = sanitizePersistedTurnRenderItem(rawItem);
    if (!item) {
      continue;
    }

    if (item.type === "bash_line") {
      if (bashLines >= RENDER_TRANSCRIPT_LIMITS.bashLinesPerTurn) {
        notices.add(
          `bash output clipped after ${RENDER_TRANSCRIPT_LIMITS.bashLinesPerTurn} lines`,
        );
        continue;
      }
      bashLines += 1;
    }

    if (item.type === "diff") {
      if (diffBlocks >= RENDER_TRANSCRIPT_LIMITS.diffBlocksPerTurn) {
        notices.add(
          `diff preview clipped after ${RENDER_TRANSCRIPT_LIMITS.diffBlocksPerTurn} blocks`,
        );
        continue;
      }
      diffBlocks += 1;
    }

    if (item.type === "warning") {
      if (warningCount >= RENDER_TRANSCRIPT_LIMITS.warningCountPerTurn) {
        notices.add(
          `warnings clipped after ${RENDER_TRANSCRIPT_LIMITS.warningCountPerTurn} entries`,
        );
        continue;
      }
      warningCount += 1;
    }

    if (item.type === "error") {
      if (errorCount >= RENDER_TRANSCRIPT_LIMITS.errorCountPerTurn) {
        notices.add(
          `errors clipped after ${RENDER_TRANSCRIPT_LIMITS.errorCountPerTurn} entries`,
        );
        continue;
      }
      errorCount += 1;
    }

    if (items.length >= RENDER_TRANSCRIPT_LIMITS.maxItemsPerTurn) {
      itemLimitReached = true;
      break;
    }

    items.push(item);
  }

  if (itemLimitReached) {
    notices.add(
      `turn replay clipped after ${RENDER_TRANSCRIPT_LIMITS.maxItemsPerTurn} items`,
    );
  }

  if (notices.size > 0) {
    const warning = sanitizePersistedTurnRenderItem({
      type: "warning",
      code: "TRANSCRIPT_TRUNCATED",
      text: [...notices].join("; "),
    });
    if (warning) {
      if (items.length >= RENDER_TRANSCRIPT_LIMITS.maxItemsPerTurn) {
        if (items.length === 0) {
          items.push(warning);
        } else {
          items[items.length - 1] = warning;
        }
      } else {
        items.push(warning);
      }
    }
  }

  return items;
}

export function hydrateTurnRenderItems(
  items: PersistedTurnRenderItem[] | undefined,
  createId: () => string,
): UiHistoryItem[] {
  return (items ?? []).map((item) => ({
    id: createId(),
    ...item,
  }));
}

export function filterPersistedTurnRenderItemsForReplay(
  items: PersistedTurnRenderItem[] | undefined,
  options?: {
    includeReasoning?: boolean;
  },
): PersistedTurnRenderItem[] {
  const includeReasoning = options?.includeReasoning === true;
  return (items ?? []).filter((item) => includeReasoning || item.type !== "reasoning");
}

function sanitizePersistedTurnRenderItem(
  value: unknown,
): PersistedTurnRenderItem | null {
  const record = isRecord(value) ? value : null;
  if (!record || typeof record.type !== "string") {
    return null;
  }

  switch (record.type) {
    case "user_prompt": {
      const text = clipText(readString(record.text) ?? "", RENDER_TRANSCRIPT_LIMITS.userPromptChars);
      return text ? { type: "user_prompt", text } : null;
    }
    case "assistant_text": {
      const text = clipText(readString(record.text) ?? "", RENDER_TRANSCRIPT_LIMITS.assistantChars);
      return text ? { type: "assistant_text", text } : null;
    }
    case "reasoning": {
      const text = clipText(readString(record.text) ?? "", RENDER_TRANSCRIPT_LIMITS.reasoningChars);
      return text ? { type: "reasoning", text } : null;
    }
    case "tool_call": {
      const toolName = clipInline(
        readString(record.toolName) ?? "unknown",
        RENDER_TRANSCRIPT_LIMITS.toolNameChars,
      );
      return {
        type: "tool_call",
        callId: clipInlineMaybe(readString(record.callId), 120),
        toolName,
        target: clipInlineMaybe(readString(record.target), RENDER_TRANSCRIPT_LIMITS.targetChars),
        argsSummary: clipInlineMaybe(
          readString(record.argsSummary),
          RENDER_TRANSCRIPT_LIMITS.argsSummaryChars,
        ),
      };
    }
    case "tool_result": {
      const toolName = clipInline(
        readString(record.toolName) ?? "unknown",
        RENDER_TRANSCRIPT_LIMITS.toolNameChars,
      );
      const summary = clipText(
        readString(record.summary) ?? "",
        RENDER_TRANSCRIPT_LIMITS.toolSummaryChars,
      );
      if (!summary) {
        return null;
      }

      return {
        type: "tool_result",
        callId: clipInlineMaybe(readString(record.callId), 120),
        toolName,
        summary,
        status: readToolStatus(record.status) ?? "error",
      };
    }
    case "bash_line": {
      const text = clipOutputLine(
        readString(record.text) ?? "",
        RENDER_TRANSCRIPT_LIMITS.bashLineChars,
      );
      if (!text) {
        return null;
      }

      return {
        type: "bash_line",
        callId: clipInlineMaybe(readString(record.callId), 120),
        toolName: clipInlineMaybe(readString(record.toolName), RENDER_TRANSCRIPT_LIMITS.toolNameChars),
        text,
      };
    }
    case "diff": {
      const text = clipText(readString(record.text) ?? "", RENDER_TRANSCRIPT_LIMITS.diffChars);
      if (!text) {
        return null;
      }

      return {
        type: "diff",
        callId: clipInlineMaybe(readString(record.callId), 120),
        toolName: clipInlineMaybe(readString(record.toolName), RENDER_TRANSCRIPT_LIMITS.toolNameChars),
        path: clipInlineMaybe(readString(record.path), RENDER_TRANSCRIPT_LIMITS.pathChars),
        text,
      };
    }
    case "warning":
    case "error": {
      const text = clipText(readString(record.text) ?? "", RENDER_TRANSCRIPT_LIMITS.noticeChars);
      if (!text) {
        return null;
      }

      return {
        type: record.type,
        callId: clipInlineMaybe(readString(record.callId), 120),
        toolName: clipInlineMaybe(readString(record.toolName), RENDER_TRANSCRIPT_LIMITS.toolNameChars),
        code: clipInlineMaybe(readString(record.code), 80),
        text,
      };
    }
    default:
      return null;
  }
}

function clipInline(value: string, maxChars: number): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxChars) {
    return normalized;
  }

  const marker = " ...[truncated]... ";
  const head = Math.max(0, Math.floor((maxChars - marker.length) * 0.7));
  const tail = Math.max(0, maxChars - marker.length - head);
  return `${normalized.slice(0, head)}${marker}${normalized.slice(-tail)}`;
}

function clipText(value: string, maxChars: number): string {
  const normalized = value.replace(/\r\n/g, "\n");
  if (normalized.length <= maxChars) {
    return normalized;
  }

  const marker = "\n...[truncated]...\n";
  const head = Math.max(0, Math.floor((maxChars - marker.length) * 0.65));
  const tail = Math.max(0, maxChars - marker.length - head);
  return `${normalized.slice(0, head)}${marker}${normalized.slice(-tail)}`;
}

function clipOutputLine(value: string, maxChars: number): string {
  const normalized = value.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  if (normalized.length <= maxChars) {
    return normalized;
  }

  const marker = " ...[truncated]... ";
  const head = Math.max(0, Math.floor((maxChars - marker.length) * 0.7));
  const tail = Math.max(0, maxChars - marker.length - head);
  return `${normalized.slice(0, head)}${marker}${normalized.slice(-tail)}`;
}

function clipInlineMaybe(value: string | undefined, maxChars: number): string | undefined {
  if (!value) {
    return undefined;
  }

  return clipInline(value, maxChars);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function readToolStatus(value: unknown): ToolCompletionStatus | undefined {
  return value === "success" || value === "error" || value === "denied"
    ? value
    : undefined;
}
