import pc from "picocolors";

export class UiRenderer {
  readonly #interactive: boolean;
  readonly #showReasoning: boolean;

  constructor(options?: { interactive?: boolean }) {
    this.#interactive = options?.interactive ?? process.stdout.isTTY;
    this.#showReasoning = isTruthy(process.env.XPERT_CLI_SHOW_REASONING);
  }

  get interactive(): boolean {
    return this.#interactive;
  }

  writeText(text: string): void {
    process.stdout.write(text);
  }

  printLine(message = ""): void {
    process.stdout.write(`${message}\n`);
  }

  printHeader(message: string): void {
    this.printLine(pc.bold(message));
  }

  printReasoning(text: string): void {
    if (!this.#showReasoning) {
      return;
    }
    this.printLine(pc.dim(`[reasoning] ${text}`));
  }

  printToolCall(toolName: string, target?: string): void {
    this.printLine(
      pc.cyan(`tool`) +
        pc.dim(": ") +
        pc.bold(toolName) +
        (target ? pc.dim(` -> ${target}`) : ""),
    );
  }

  printToolAck(toolName: string, summary: string): void {
    this.printLine(pc.green(`done`) + pc.dim(` ${toolName}: ${summary}`));
  }

  printBashLine(line: string): void {
    this.printLine(pc.dim(line));
  }

  printDiff(diffText: string): void {
    this.printLine(pc.yellow(diffText));
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
}

function isTruthy(value: string | undefined): boolean {
  return value === "1" || value === "true";
}
