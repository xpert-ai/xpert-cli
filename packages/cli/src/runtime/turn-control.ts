export class TurnCancelledError extends Error {
  constructor(message = "Turn cancelled") {
    super(message);
    this.name = "TurnCancelledError";
  }
}

export async function runInterruptibleTurn<T>(
  run: (signal: AbortSignal) => Promise<T>,
  options?: { onCancel?: () => void },
): Promise<T> {
  const controller = new AbortController();

  const onSigint = () => {
    if (controller.signal.aborted) {
      return;
    }
    controller.abort(createAbortError());
    options?.onCancel?.();
  };

  process.on("SIGINT", onSigint);

  try {
    return await run(controller.signal);
  } catch (error) {
    if (controller.signal.aborted || isAbortError(error)) {
      throw new TurnCancelledError();
    }
    throw error;
  } finally {
    process.off("SIGINT", onSigint);
  }
}

export function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

export function createAbortError(message = "The operation was aborted"): Error {
  const error = new Error(message);
  error.name = "AbortError";
  return error;
}

export function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw signal.reason instanceof Error ? signal.reason : createAbortError();
  }
}
