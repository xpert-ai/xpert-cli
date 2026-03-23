export type UiEvent =
  | { type: "assistant_text"; text: string }
  | { type: "reasoning"; text: string }
  | { type: "tool_call"; toolName: string; target?: string }
  | { type: "tool_ack"; toolName: string; summary: string }
  | { type: "bash_line"; line: string }
  | { type: "diff"; diffText: string }
  | { type: "warning"; message: string }
  | { type: "error"; message: string };
