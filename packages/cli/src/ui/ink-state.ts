import type { UiEvent } from "./events.js";
import type { PendingTurnState } from "./history.js";

export function applyUiEvent(
  pending: PendingTurnState,
  event: UiEvent,
): PendingTurnState {
  switch (event.type) {
    case "assistant_text":
      return appendAssistantText(pending, event.text);
    case "reasoning":
      return pushPendingItem(pending, {
        type: "reasoning",
        text: event.text,
      });
    case "tool_call":
      return pushPendingItem(pending, {
        type: "tool_call",
        toolName: event.toolName,
        target: event.target,
      });
    case "tool_ack":
      return pushPendingItem(pending, {
        type: "tool_result",
        toolName: event.toolName,
        summary: event.summary,
      });
    case "bash_line":
      return pushPendingItem(pending, {
        type: "bash_line",
        text: event.line,
      });
    case "diff":
      return pushPendingItem(pending, {
        type: "diff",
        text: event.diffText,
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
  }
}

function pushPendingItem(
  pending: PendingTurnState,
  item: PendingTurnState["items"][number],
): PendingTurnState {
  return {
    ...pending,
    items: [...pending.items, item],
  };
}

function appendAssistantText(
  pending: PendingTurnState,
  text: string,
): PendingTurnState {
  const lastItem = pending.items[pending.items.length - 1];
  if (lastItem?.type === "assistant_text") {
    return {
      ...pending,
      items: [
        ...pending.items.slice(0, -1),
        {
          ...lastItem,
          text: lastItem.text + text,
        },
      ],
    };
  }

  return pushPendingItem(pending, {
    type: "assistant_text",
    text,
  });
}
