import { describe, expect, it } from "vitest";
import { resolveCtrlCDecision } from "../ui/ctrl-c.js";

describe("resolveCtrlCDecision", () => {
  it("cancels the active turn on the first Ctrl+C while running", () => {
    expect(
      resolveCtrlCDecision({
        turnState: "running",
        now: 1_000,
        windowMs: 1_200,
      }),
    ).toEqual({ kind: "cancel_turn" });
  });

  it("requests exit on the first Ctrl+C while idle", () => {
    expect(
      resolveCtrlCDecision({
        turnState: "idle",
        now: 1_000,
        windowMs: 1_200,
      }),
    ).toEqual({ kind: "request_exit" });
  });

  it("exits immediately on a repeated Ctrl+C while idle", () => {
    expect(
      resolveCtrlCDecision({
        turnState: "idle",
        now: 1_500,
        lastCtrlCAt: 1_000,
        windowMs: 1_200,
      }),
    ).toEqual({ kind: "exit_now" });
  });

  it("requests exit after cancellation on a repeated Ctrl+C while running", () => {
    expect(
      resolveCtrlCDecision({
        turnState: "running",
        now: 1_500,
        lastCtrlCAt: 1_000,
        windowMs: 1_200,
      }),
    ).toEqual({ kind: "request_exit" });
  });
});
