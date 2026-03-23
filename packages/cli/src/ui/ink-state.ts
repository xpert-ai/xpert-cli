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
        toolName: event.toolName,
        target: event.target,
      });
    case "tool_output_line":
    case "bash_line":
      return pushPendingItem(pending, {
        type: "bash_line",
        text: event.line,
      });
    case "tool_diff":
    case "diff":
      return pushPendingItem(pending, {
        type: "diff",
        text: event.diffText,
      });
    case "tool_completed":
      if (event.status !== "success") {
        return pending;
      }
      return pushPendingItem(pending, {
        type: "tool_result",
        toolName: event.toolName,
        summary: event.summary,
      });
    case "tool_ack":
      return pushPendingItem(pending, {
        type: "tool_result",
        toolName: event.toolName,
        summary: event.summary,
      });
    case "warning":
      return pushPendingItem(pending, {
        type: "warning",
        text: event.message,
      });
    case "error":
      return pushPendingItem(pending, {
        type: "error",
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
