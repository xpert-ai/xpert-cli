import type { CliExecutionMode } from "./mode.js";
import { shouldUseAlternateBuffer } from "./mode.js";

const ENTER_ALTERNATE_BUFFER = "\u001b[?1049h\u001b[2J\u001b[H";
const EXIT_ALTERNATE_BUFFER = "\u001b[?1049l";

export interface TuiRuntime {
  readonly active: boolean;
  enter(): void;
  restore(): void;
}

export async function runWithTuiRuntime<TValue>(
  runtime: TuiRuntime,
  run: () => Promise<TValue> | TValue,
): Promise<TValue> {
  runtime.enter();

  try {
    return await run();
  } finally {
    runtime.restore();
  }
}

export function createTuiRuntime(options: {
  mode: CliExecutionMode;
  stdout?: Pick<NodeJS.WriteStream, "isTTY" | "write">;
}): TuiRuntime {
  const stdout = options.stdout ?? process.stdout;
  const active = shouldUseAlternateBuffer(options.mode) && stdout.isTTY === true;
  let entered = false;

  return {
    active,
    enter() {
      if (!active || entered) {
        return;
      }

      entered = true;
      stdout.write(ENTER_ALTERNATE_BUFFER);
    },
    restore() {
      if (!active || !entered) {
        return;
      }

      entered = false;
      stdout.write(EXIT_ALTERNATE_BUFFER);
    },
  };
}
