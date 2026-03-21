import readline from "node:readline/promises";
import type { ResolvedXpertCliConfig } from "@xpert-cli/contracts";
import type { CliSessionState, SessionStore } from "./runtime/session-store.js";
import { runAgentTurn } from "./agent-loop.js";
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

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  try {
    while (true) {
      const prompt = (await rl.question("xpert> ")).trim();
      if (!prompt) {
        continue;
      }
      if (prompt === "/exit" || prompt === "exit") {
        break;
      }

      options.session = await runAgentTurn({
        prompt,
        config: options.config,
        session: options.session,
        interactive: true,
      });
      await options.sessionStore.save(options.session);
      ui.printLine();
    }
  } finally {
    rl.close();
  }
}
