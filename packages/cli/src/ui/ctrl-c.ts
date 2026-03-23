export type CtrlCState = "idle" | "running" | "waiting_permission";

export interface CtrlCDecision {
  kind: "cancel_turn" | "request_exit" | "exit_now";
}

export interface CtrlCAction {
  shouldCancelTurn: boolean;
  shouldExitNow: boolean;
  exitAfterTurn: boolean;
  notice: string;
  lastCtrlCAt: number;
}

export function resolveCtrlCDecision(input: {
  turnState: CtrlCState;
  now: number;
  lastCtrlCAt?: number;
  windowMs: number;
}): CtrlCDecision {
  const repeated =
    input.lastCtrlCAt !== undefined &&
    input.now - input.lastCtrlCAt <= input.windowMs;

  if (repeated) {
    return input.turnState === "idle"
      ? { kind: "exit_now" }
      : { kind: "request_exit" };
  }

  return input.turnState === "idle"
    ? { kind: "request_exit" }
    : { kind: "cancel_turn" };
}

export function resolveCtrlCAction(input: {
  turnState: CtrlCState;
  now: number;
  lastCtrlCAt?: number;
  windowMs: number;
}): CtrlCAction {
  const decision = resolveCtrlCDecision(input);

  switch (decision.kind) {
    case "exit_now":
      return {
        shouldCancelTurn: false,
        shouldExitNow: true,
        exitAfterTurn: false,
        notice: "exiting interactive mode",
        lastCtrlCAt: input.now,
      };
    case "request_exit":
      return {
        shouldCancelTurn: input.turnState !== "idle",
        shouldExitNow: false,
        exitAfterTurn: input.turnState !== "idle",
        notice:
          input.turnState === "idle"
            ? "press Ctrl+C again to exit"
            : "press Ctrl+C again to exit",
        lastCtrlCAt: input.now,
      };
    case "cancel_turn":
      return {
        shouldCancelTurn: true,
        shouldExitNow: false,
        exitAfterTurn: false,
        notice: "cancelled current turn. Press Ctrl+C again to exit.",
        lastCtrlCAt: input.now,
      };
  }
}
