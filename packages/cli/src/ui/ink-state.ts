import type { TurnEvent } from "../runtime/turn-events.js";
import type { UiEvent } from "./events.js";
import type { PendingTurnState } from "./history.js";

export function applyTurnEvent(
  pending: PendingTurnState,
  event: TurnEvent | UiEvent,
): PendingTurnState {
  switch (event.type) {
    case "assistant_text_delta":
    case "assistant_text":
      return appendAssistantText(pending, event.text);
    case "reasoning":
      return pushPendingItem(pending, {
        type: "reasoning",
        text: event.text,
      });
    case "tool_requested":
    case "tool_call":
      return pushPendingItem(pending, {
        type: "tool_call",
        callId: "callId" in event ? event.callId : undefined,
        toolName: event.toolName,
        target: event.target,
        argsSummary: "argsSummary" in event ? event.argsSummary : undefined,
      });
    case "permission_requested":
      return pushPendingItem(pending, {
        type: "permission_requested",
        callId: event.callId,
        toolName: event.toolName,
        riskLevel: event.riskLevel,
        scope: event.scope,
        target: event.target,
        reason: event.reason,
      });
    case "permission_resolved":
      return pushPendingItem(pending, {
        type: "permission_resolved",
        callId: event.callId,
        toolName: event.toolName,
        riskLevel: event.riskLevel,
        scope: event.scope,
        allowed: event.allowed,
        decision: event.decision,
        remembered: event.remembered,
        target: event.target,
        reason: event.reason,
      });
    case "tool_output_line":
    case "bash_line":
      return pushPendingItem(pending, {
        type: "bash_line",
        callId: "callId" in event ? event.callId : undefined,
        toolName: "toolName" in event ? event.toolName : undefined,
        text: event.line,
      });
    case "tool_diff":
    case "diff":
      return pushPendingItem(pending, {
        type: "diff",
        callId: "callId" in event ? event.callId : undefined,
        toolName: "toolName" in event ? event.toolName : undefined,
        path: "path" in event ? event.path : undefined,
        text: event.diffText,
      });
    case "tool_completed":
      return pushPendingItem(pending, {
        type: "tool_result",
        callId: event.callId,
        toolName: event.toolName,
        summary: event.summary,
        status: event.status,
      });
    case "tool_ack":
      return pushPendingItem(pending, {
        type: "tool_result",
        toolName: event.toolName,
        summary: event.summary,
        status: "success",
      });
    case "warning":
      if ("code" in event && event.code === "STALE_THREAD_RETRY") {
        return pending;
      }
      return pushPendingItem(pending, {
        type: "warning",
        callId: "callId" in event ? event.callId : undefined,
        toolName: "toolName" in event ? event.toolName : undefined,
        code: "code" in event ? event.code : undefined,
        text: event.message,
      });
    case "error":
      return pushPendingItem(pending, {
        type: "error",
        callId: "callId" in event ? event.callId : undefined,
        toolName: "toolName" in event ? event.toolName : undefined,
        code: "code" in event ? event.code : undefined,
        text: event.message,
      });
    default:
      return pending;
  }
}

function pushPendingItem(
  pending: PendingTurnState,
  item: PendingTurnState["entries"][number],
): PendingTurnState {
  const entries = [...pending.entries, item];
  return {
    ...pending,
    entries,
    items: entries,
  };
}

function appendAssistantText(
  pending: PendingTurnState,
  text: string,
): PendingTurnState {
  const lastItem = pending.entries[pending.entries.length - 1];
  if (lastItem?.type === "assistant_text") {
    const entries = [
      ...pending.entries.slice(0, -1),
      {
        ...lastItem,
        text: lastItem.text + text,
      },
    ];
    return {
      ...pending,
      entries,
      items: entries,
    };
  }

  return pushPendingItem(pending, {
    type: "assistant_text",
    text,
  });
}

export const applyUiEvent = applyTurnEvent;
