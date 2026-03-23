export type UiHistoryItem =
  | { id: string; type: "info"; text: string }
  | { id: string; type: "user_prompt"; text: string }
  | { id: string; type: "assistant_text"; text: string }
  | { id: string; type: "reasoning"; text: string }
  | { id: string; type: "tool_call"; toolName: string; target?: string }
  | { id: string; type: "tool_result"; toolName: string; summary: string }
  | { id: string; type: "bash_line"; text: string }
  | { id: string; type: "diff"; text: string }
  | { id: string; type: "warning"; text: string }
  | { id: string; type: "error"; text: string }
  | { id: string; type: "status_view"; title: string; lines: string[] }
  | { id: string; type: "tools_view"; title: string; lines: string[] }
  | { id: string; type: "session_view"; title: string; lines: string[] };

export type UiHistoryItemInput =
  | { type: "info"; text: string }
  | { type: "user_prompt"; text: string }
  | { type: "assistant_text"; text: string }
  | { type: "reasoning"; text: string }
  | { type: "tool_call"; toolName: string; target?: string }
  | { type: "tool_result"; toolName: string; summary: string }
  | { type: "bash_line"; text: string }
  | { type: "diff"; text: string }
  | { type: "warning"; text: string }
  | { type: "error"; text: string }
  | { type: "status_view"; title: string; lines: string[] }
  | { type: "tools_view"; title: string; lines: string[] }
  | { type: "session_view"; title: string; lines: string[] };

export type PendingTurnEntry =
  | { type: "assistant_text"; text: string }
  | { type: "reasoning"; text: string }
  | { type: "tool_call"; toolName: string; target?: string }
  | { type: "tool_result"; toolName: string; summary: string }
  | { type: "bash_line"; text: string }
  | { type: "diff"; text: string }
  | { type: "warning"; text: string }
  | { type: "error"; text: string };

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
  return pending.entries.map((item) => {
    switch (item.type) {
      case "assistant_text":
        return { id: createId(), type: "assistant_text", text: item.text };
      case "reasoning":
        return { id: createId(), type: "reasoning", text: item.text };
      case "tool_call":
        return {
          id: createId(),
          type: "tool_call",
          toolName: item.toolName,
          target: item.target,
        };
      case "tool_result":
        return {
          id: createId(),
          type: "tool_result",
          toolName: item.toolName,
          summary: item.summary,
        };
      case "bash_line":
        return { id: createId(), type: "bash_line", text: item.text };
      case "diff":
        return { id: createId(), type: "diff", text: item.text };
      case "warning":
        return { id: createId(), type: "warning", text: item.text };
      case "error":
        return { id: createId(), type: "error", text: item.text };
    }
  });
}
