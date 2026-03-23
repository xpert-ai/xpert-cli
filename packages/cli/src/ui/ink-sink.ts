import type { TurnEvent } from "../runtime/turn-events.js";
import type { UiSink } from "./sink.js";

export class InkUiSink implements UiSink {
  readonly #dispatch: (event: TurnEvent) => void;
  readonly #showReasoning: boolean;
  readonly #onNotice?: (input: {
    level: "warning" | "error";
    message: string;
  }) => void;

  constructor(options: {
    dispatch: (event: TurnEvent) => void;
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

  consume(event: TurnEvent): void {
    if (event.type === "reasoning" && !this.#showReasoning) {
      return;
    }

    if (event.type === "warning") {
      this.#onNotice?.({ level: "warning", message: event.message });
    }

    if (event.type === "error") {
      this.#onNotice?.({ level: "error", message: event.message });
    }

    this.#dispatch(event);
  }
}

function isTruthy(value: string | undefined): boolean {
  return value === "1" || value === "true";
}
