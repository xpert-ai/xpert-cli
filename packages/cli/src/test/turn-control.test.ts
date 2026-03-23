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

  it("exposes an explicit cancel handle for raw-input UIs", async () => {
    const onCancel = vi.fn();
    let cancel: (() => void) | undefined;

    const execution = runInterruptibleTurn(
      (signal) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener(
            "abort",
            () => reject(signal.reason),
            { once: true },
          );
        }),
      {
        onCancel,
        onStart: (handle) => {
          cancel = handle.cancel;
        },
      },
    );

    expect(cancel).toBeTypeOf("function");
    cancel?.();

    await expect(execution).rejects.toBeInstanceOf(TurnCancelledError);
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("can skip installing a SIGINT handler when the UI handles Ctrl+C itself", async () => {
    const onSpy = vi.spyOn(process, "on");
    const offSpy = vi.spyOn(process, "off");
    let cancel: (() => void) | undefined;

    const execution = runInterruptibleTurn(
      (signal) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener(
            "abort",
            () => reject(signal.reason),
            { once: true },
          );
        }),
      {
        captureSigint: false,
        onStart: (handle) => {
          cancel = handle.cancel;
        },
      },
    );

    cancel?.();

    await expect(execution).rejects.toBeInstanceOf(TurnCancelledError);
    expect(onSpy).not.toHaveBeenCalledWith("SIGINT", expect.any(Function));
    expect(offSpy).not.toHaveBeenCalledWith("SIGINT", expect.any(Function));

    onSpy.mockRestore();
    offSpy.mockRestore();
  });
});
