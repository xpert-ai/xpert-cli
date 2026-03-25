import { describe, expect, it } from "vitest";
import { createTuiRuntime, runWithTuiRuntime } from "../ui/tui-runtime.js";

describe("tui runtime", () => {
  it("keeps alternate buffer disabled for interactive ink by default", () => {
    const writes: string[] = [];
    const runtime = createTuiRuntime({
      mode: "interactive_ink",
      stdout: {
        isTTY: true,
        write(chunk: string) {
          writes.push(chunk);
          return true;
        },
      },
    });

    runtime.enter();
    runtime.restore();

    expect(runtime.active).toBe(false);
    expect(writes).toEqual([]);
  });

  it("keeps alternate buffer disabled for text and non-tty flows", () => {
    const writes: string[] = [];
    const singlePrompt = createTuiRuntime({
      mode: "single_prompt",
      stdout: {
        isTTY: true,
        write(chunk: string) {
          writes.push(chunk);
          return true;
        },
      },
    });
    const nonTty = createTuiRuntime({
      mode: "interactive_ink",
      stdout: {
        isTTY: false,
        write(chunk: string) {
          writes.push(chunk);
          return true;
        },
      },
    });

    singlePrompt.enter();
    singlePrompt.restore();
    nonTty.enter();
    nonTty.restore();

    expect(singlePrompt.active).toBe(false);
    expect(nonTty.active).toBe(false);
    expect(writes).toEqual([]);
  });

  it("does not write alternate buffer escape codes even when startup throws", async () => {
    const writes: string[] = [];
    const runtime = createTuiRuntime({
      mode: "interactive_ink",
      stdout: {
        isTTY: true,
        write(chunk: string) {
          writes.push(chunk);
          return true;
        },
      },
    });

    await expect(
      runWithTuiRuntime(runtime, () => {
        throw new Error("render failed");
      }),
    ).rejects.toThrow("render failed");

    expect(writes).toEqual([]);
  });
});
