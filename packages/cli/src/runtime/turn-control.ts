export class TurnCancelledError extends Error {
  constructor(message = "Turn cancelled") {
    super(message);
    this.name = "TurnCancelledError";
  }
}

export interface InterruptibleTurnHandle {
  signal: AbortSignal;
  cancel: () => void;
}

export async function runInterruptibleTurn<T>(
  run: (signal: AbortSignal) => Promise<T>,
  options?: {
    onCancel?: () => void;
    onStart?: (handle: InterruptibleTurnHandle) => void;
    captureSigint?: boolean;
  },
): Promise<T> {
  const controller = new AbortController();
  let cancelled = false;

  const cancel = () => {
    if (cancelled || controller.signal.aborted) {
      return;
    }

    cancelled = true;
    controller.abort(createAbortError());
    options?.onCancel?.();
  };

  const onSigint = () => {
    cancel();
  };

  if (options?.captureSigint !== false) {
    process.on("SIGINT", onSigint);
  }
  options?.onStart?.({
    signal: controller.signal,
    cancel,
  });

  try {
    return await run(controller.signal);
  } catch (error) {
    if (controller.signal.aborted || isAbortError(error)) {
      throw new TurnCancelledError();
    }
    throw error;
  } finally {
    if (options?.captureSigint !== false) {
      process.off("SIGINT", onSigint);
    }
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
