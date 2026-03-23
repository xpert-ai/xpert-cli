import pc from "picocolors";
import type { TurnEvent } from "../runtime/turn-events.js";
import type { UiSink } from "./sink.js";

export class TextUiRenderer implements UiSink {
  readonly #interactive: boolean;
  readonly #showReasoning: boolean;
  #needsLineBreak = false;

  constructor(options?: { interactive?: boolean }) {
    this.#interactive = options?.interactive ?? process.stdout.isTTY;
    this.#showReasoning = isTruthy(process.env.XPERT_CLI_SHOW_REASONING);
  }

  get interactive(): boolean {
    return this.#interactive;
  }

  printLine(message = ""): void {
    process.stdout.write(`${message}\n`);
  }

  printHeader(message: string): void {
    this.printLine(pc.bold(message));
  }

  consume(event: TurnEvent): void {
    switch (event.type) {
      case "assistant_text_delta":
        this.#appendAssistantText(event.text);
        return;
      case "reasoning":
        if (!this.#showReasoning) {
          return;
        }
        this.#ensureLineBreak();
        this.printLine(pc.dim(`[reasoning] ${event.text}`));
        return;
      case "tool_requested":
        this.#ensureLineBreak();
        this.printLine(
          pc.cyan("tool") +
            pc.dim(": ") +
            pc.bold(event.toolName) +
            (event.target ? pc.dim(` -> ${event.target}`) : ""),
        );
        return;
      case "tool_output_line":
        this.#ensureLineBreak();
        this.printLine(pc.dim(event.line));
        return;
      case "tool_diff":
        this.#ensureLineBreak();
        this.printLine(pc.yellow(event.diffText));
        return;
      case "tool_completed":
        if (event.status !== "success") {
          return;
        }
        this.#ensureLineBreak();
        this.printLine(pc.green("done") + pc.dim(` ${event.toolName}: ${event.summary}`));
        return;
      case "warning":
        this.#ensureLineBreak();
        this.printLine(pc.yellow(`warn: ${event.message}`));
        return;
      case "error":
        this.#ensureLineBreak();
        this.printLine(pc.red(`error: ${event.message}`));
        return;
      case "turn_finished":
        this.#ensureLineBreak();
        return;
      default:
        return;
    }
  }

  printError(message: string): void {
    this.printLine(pc.red(`error: ${message}`));
  }

  printWarning(message: string): void {
    this.printLine(pc.yellow(`warn: ${message}`));
  }

  printSuccess(message: string): void {
    this.printLine(pc.green(message));
  }

  printJson(value: unknown): void {
    this.printLine(JSON.stringify(value, null, 2));
  }

  #appendAssistantText(text: string): void {
    if (!text) {
      return;
    }

    process.stdout.write(text);
    this.#needsLineBreak = !text.endsWith("\n");
  }

  #ensureLineBreak(): void {
    if (!this.#needsLineBreak) {
      return;
    }

    this.printLine();
    this.#needsLineBreak = false;
  }
}

function isTruthy(value: string | undefined): boolean {
  return value === "1" || value === "true";
}
