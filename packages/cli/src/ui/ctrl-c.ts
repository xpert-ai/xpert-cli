export type CtrlCState = "idle" | "running" | "waiting";

export interface CtrlCDecision {
  kind: "cancel_turn" | "request_exit" | "exit_now";
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
