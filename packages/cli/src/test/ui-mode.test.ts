import { describe, expect, it } from "vitest";
import { resolveCliExecutionMode } from "../ui/mode.js";

describe("resolveCliExecutionMode", () => {
  it("routes interactive TTY sessions to Ink", () => {
    expect(
      resolveCliExecutionMode({
        stdinIsTTY: true,
        stdoutIsTTY: true,
      }),
    ).toBe("interactive_ink");
  });

  it("keeps single-prompt mode on the text path", () => {
    expect(
      resolveCliExecutionMode({
        prompt: "summarize README.md",
        stdinIsTTY: true,
        stdoutIsTTY: true,
      }),
    ).toBe("single_prompt");
  });

  it("keeps non-tty sessions on the text path", () => {
    expect(
      resolveCliExecutionMode({
        stdinIsTTY: false,
        stdoutIsTTY: true,
      }),
    ).toBe("interactive_text");
  });
});
