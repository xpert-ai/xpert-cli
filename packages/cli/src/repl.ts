import readline from "node:readline/promises";
import type { ResolvedXpertCliConfig } from "@xpert-cli/contracts";
import type { CliSessionState, SessionStore } from "./runtime/session-store.js";
import { runAgentTurn } from "./agent-loop.js";
import { runInterruptibleTurn, TurnCancelledError } from "./runtime/turn-control.js";
import { UiRenderer } from "./ui/renderer.js";

export async function runRepl(options: {
  config: ResolvedXpertCliConfig;
  session: CliSessionState;
  sessionStore: SessionStore;
}): Promise<void> {
  const ui = new UiRenderer({ interactive: true });
  ui.printHeader(`xpert session ${options.session.sessionId}`);
  ui.printLine(`cwd: ${options.session.cwd}`);
  ui.printLine("Type `/exit` to quit.");
  ui.printLine();

  while (true) {
    const input = await promptOnce("xpert> ");
    if (input == null) {
      break;
    }

    const prompt = input.trim();
    if (!prompt) {
      continue;
    }
    if (prompt === "/exit" || prompt === "exit") {
      break;
    }

    try {
      options.session = await runInterruptibleTurn(
        (signal) =>
          runAgentTurn({
            prompt,
            config: options.config,
            session: options.session,
            interactive: true,
            signal,
          }),
        {
          onCancel: () => {
            ui.printLine();
            ui.printWarning("cancelled current turn");
          },
        },
      );
      await options.sessionStore.save(options.session);
      ui.printLine();
    } catch (error) {
      if (error instanceof TurnCancelledError) {
        ui.printLine();
        continue;
      }
      throw error;
    }
  }
}

async function promptOnce(message: string): Promise<string | null> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  try {
    return await rl.question(message);
  } catch (error) {
    if (isReadlineClosedError(error)) {
      return null;
    }
    throw error;
  } finally {
    rl.close();
  }
}

function isReadlineClosedError(error: unknown): boolean {
  return error instanceof Error && error.message === "readline was closed";
}
