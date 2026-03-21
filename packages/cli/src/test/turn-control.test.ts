import { describe, expect, it, vi } from "vitest";
import { runInterruptibleTurn, TurnCancelledError } from "../runtime/turn-control.js";

describe("runInterruptibleTurn", () => {
  it("turns SIGINT into a cancellable turn error", async () => {
    const onCancel = vi.fn();

    const execution = runInterruptibleTurn(
      (signal) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener(
            "abort",
            () => reject(signal.reason),
            { once: true },
          );
        }),
      { onCancel },
    );

    setTimeout(() => {
      process.emit("SIGINT");
    }, 20);

    await expect(execution).rejects.toBeInstanceOf(TurnCancelledError);
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
