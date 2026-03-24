import type { RiskLevel } from "@xpert-cli/contracts";
import type { ToolCompletionStatus } from "../runtime/turn-events.js";

interface ToolCallEntryBase {
  callId?: string;
  toolName: string;
  target?: string;
  argsSummary?: string;
}

interface ToolNoticeEntryBase {
  callId?: string;
  toolName?: string;
  code?: string;
  text: string;
}

export type UiHistoryItem =
  | { id: string; type: "info"; text: string }
  | { id: string; type: "user_prompt"; text: string }
  | { id: string; type: "assistant_text"; text: string }
  | { id: string; type: "reasoning"; text: string }
  | ({ id: string; type: "tool_call" } & ToolCallEntryBase)
  | {
      id: string;
      type: "tool_result";
      callId?: string;
      toolName: string;
      summary: string;
      status: ToolCompletionStatus;
    }
  | { id: string; type: "bash_line"; callId?: string; toolName?: string; text: string }
  | { id: string; type: "diff"; callId?: string; toolName?: string; path?: string; text: string }
  | ({ id: string; type: "warning" } & ToolNoticeEntryBase)
  | ({ id: string; type: "error" } & ToolNoticeEntryBase)
  | { id: string; type: "status_view"; title: string; lines: string[] }
  | { id: string; type: "tools_view"; title: string; lines: string[] }
  | { id: string; type: "session_view"; title: string; lines: string[] };

export type UiHistoryItemInput =
  | { type: "info"; text: string }
  | { type: "user_prompt"; text: string }
  | { type: "assistant_text"; text: string }
  | { type: "reasoning"; text: string }
  | ({ type: "tool_call" } & ToolCallEntryBase)
  | {
      type: "tool_result";
      callId?: string;
      toolName: string;
      summary: string;
      status: ToolCompletionStatus;
    }
  | { type: "bash_line"; callId?: string; toolName?: string; text: string }
  | { type: "diff"; callId?: string; toolName?: string; path?: string; text: string }
  | ({ type: "warning" } & ToolNoticeEntryBase)
  | ({ type: "error" } & ToolNoticeEntryBase)
  | { type: "status_view"; title: string; lines: string[] }
  | { type: "tools_view"; title: string; lines: string[] }
  | { type: "session_view"; title: string; lines: string[] };

export type PendingTurnEntry =
  | { type: "assistant_text"; text: string }
  | { type: "reasoning"; text: string }
  | ({ type: "tool_call" } & ToolCallEntryBase)
  | {
      type: "permission_requested";
      callId: string;
      toolName: string;
      riskLevel: RiskLevel;
      scope?: string;
      target?: string;
      reason?: string;
    }
  | {
      type: "permission_resolved";
      callId: string;
      toolName: string;
      riskLevel: RiskLevel;
      scope?: string;
      allowed: boolean;
      decision: string;
      remembered?: boolean;
      target?: string;
      reason?: string;
    }
  | {
      type: "tool_result";
      callId?: string;
      toolName: string;
      summary: string;
      status: ToolCompletionStatus;
    }
  | { type: "bash_line"; callId?: string; toolName?: string; text: string }
  | { type: "diff"; callId?: string; toolName?: string; path?: string; text: string }
  | ({ type: "warning" } & ToolNoticeEntryBase)
  | ({ type: "error" } & ToolNoticeEntryBase);

export interface PendingTurnState {
  entries: PendingTurnEntry[];
  items: PendingTurnEntry[];
}

export function createEmptyPendingTurn(): PendingTurnState {
  const entries: PendingTurnEntry[] = [];
  return {
    entries,
    items: entries,
  };
}

export function hasPendingTurnContent(pending: PendingTurnState): boolean {
  return pending.entries.length > 0;
}

export function materializePendingTurn(
  pending: PendingTurnState,
  createId: () => string,
): UiHistoryItem[] {
  const history: UiHistoryItem[] = [];

  for (const item of pending.entries) {
    switch (item.type) {
      case "assistant_text":
        history.push({ id: createId(), type: "assistant_text", text: item.text });
        continue;
      case "reasoning":
        history.push({ id: createId(), type: "reasoning", text: item.text });
        continue;
      case "tool_call":
        history.push({
          id: createId(),
          type: "tool_call",
          callId: item.callId,
          toolName: item.toolName,
          target: item.target,
          argsSummary: item.argsSummary,
        });
        continue;
      case "permission_requested":
      case "permission_resolved":
        continue;
      case "tool_result":
        history.push({
          id: createId(),
          type: "tool_result",
          callId: item.callId,
          toolName: item.toolName,
          summary: item.summary,
          status: item.status,
        });
        continue;
      case "bash_line":
        history.push({
          id: createId(),
          type: "bash_line",
          callId: item.callId,
          toolName: item.toolName,
          text: item.text,
        });
        continue;
      case "diff":
        history.push({
          id: createId(),
          type: "diff",
          callId: item.callId,
          toolName: item.toolName,
          path: item.path,
          text: item.text,
        });
        continue;
      case "warning":
        history.push({
          id: createId(),
          type: "warning",
          callId: item.callId,
          toolName: item.toolName,
          code: item.code,
          text: item.text,
        });
        continue;
      case "error":
        history.push({
          id: createId(),
          type: "error",
          callId: item.callId,
          toolName: item.toolName,
          code: item.code,
          text: item.text,
        });
        continue;
    }
  }

  return history;
}
