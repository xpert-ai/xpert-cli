import type { UiEvent } from "./events.js";
import type { UiSink } from "./sink.js";

export class InkUiSink implements UiSink {
  readonly #dispatch: (event: UiEvent) => void;
  readonly #showReasoning: boolean;
  readonly #onNotice?: (input: {
    level: "warning" | "error";
    message: string;
  }) => void;

  constructor(options: {
    dispatch: (event: UiEvent) => void;
    showReasoning?: boolean;
    onNotice?: (input: { level: "warning" | "error"; message: string }) => void;
  }) {
    this.#dispatch = options.dispatch;
    this.#showReasoning = options.showReasoning ?? isTruthy(process.env.XPERT_CLI_SHOW_REASONING);
    this.#onNotice = options.onNotice;
  }

  get interactive(): boolean {
    return true;
  }

  appendAssistantText(text: string): void {
    this.#dispatch({ type: "assistant_text", text });
  }

  showReasoning(text: string): void {
    if (!this.#showReasoning) {
      return;
    }
    this.#dispatch({ type: "reasoning", text });
  }

  showToolCall(toolName: string, target?: string): void {
    this.#dispatch({ type: "tool_call", toolName, target });
  }

  showToolAck(toolName: string, summary: string): void {
    this.#dispatch({ type: "tool_ack", toolName, summary });
  }

  showBashLine(line: string): void {
    this.#dispatch({ type: "bash_line", line });
  }

  showDiff(diffText: string): void {
    this.#dispatch({ type: "diff", diffText });
  }

  showWarning(message: string): void {
    this.#onNotice?.({ level: "warning", message });
    this.#dispatch({ type: "warning", message });
  }

  showError(message: string): void {
    this.#onNotice?.({ level: "error", message });
    this.#dispatch({ type: "error", message });
  }

  lineBreak(): void {
    // Ink renders pending content as separate blocks, so explicit line breaks are unnecessary.
  }
}

function isTruthy(value: string | undefined): boolean {
  return value === "1" || value === "true";
}
