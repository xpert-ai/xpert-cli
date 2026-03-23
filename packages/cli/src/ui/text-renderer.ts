import pc from "picocolors";
import type { UiSink } from "./sink.js";

export class TextUiRenderer implements UiSink {
  readonly #interactive: boolean;
  readonly #showReasoning: boolean;

  constructor(options?: { interactive?: boolean }) {
    this.#interactive = options?.interactive ?? process.stdout.isTTY;
    this.#showReasoning = isTruthy(process.env.XPERT_CLI_SHOW_REASONING);
  }

  get interactive(): boolean {
    return this.#interactive;
  }

  appendAssistantText(text: string): void {
    process.stdout.write(text);
  }

  lineBreak(): void {
    this.printLine();
  }

  printLine(message = ""): void {
    process.stdout.write(`${message}\n`);
  }

  printHeader(message: string): void {
    this.printLine(pc.bold(message));
  }

  showReasoning(text: string): void {
    if (!this.#showReasoning) {
      return;
    }
    this.printLine(pc.dim(`[reasoning] ${text}`));
  }

  showToolCall(toolName: string, target?: string): void {
    this.printLine(
      pc.cyan("tool") +
        pc.dim(": ") +
        pc.bold(toolName) +
        (target ? pc.dim(` -> ${target}`) : ""),
    );
  }

  showToolAck(toolName: string, summary: string): void {
    this.printLine(pc.green("done") + pc.dim(` ${toolName}: ${summary}`));
  }

  showBashLine(line: string): void {
    this.printLine(pc.dim(line));
  }

  showDiff(diffText: string): void {
    this.printLine(pc.yellow(diffText));
  }

  showError(message: string): void {
    this.printLine(pc.red(`error: ${message}`));
  }

  showWarning(message: string): void {
    this.printLine(pc.yellow(`warn: ${message}`));
  }

  printError(message: string): void {
    this.showError(message);
  }

  printWarning(message: string): void {
    this.showWarning(message);
  }

  printSuccess(message: string): void {
    this.printLine(pc.green(message));
  }

  printJson(value: unknown): void {
    this.printLine(JSON.stringify(value, null, 2));
  }
}

function isTruthy(value: string | undefined): boolean {
  return value === "1" || value === "true";
}
