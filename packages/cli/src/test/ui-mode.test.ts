import { describe, expect, it } from "vitest";
import { resolveCliExecutionMode, shouldUseAlternateBuffer } from "../ui/mode.js";

describe("resolveCliExecutionMode", () => {
  it("routes interactive TTY sessions to Ink", () => {
    const mode = resolveCliExecutionMode({
      stdinIsTTY: true,
      stdoutIsTTY: true,
    });

    expect(mode).toBe("interactive_ink");
    expect(shouldUseAlternateBuffer(mode)).toBe(false);
  });

  it("keeps single-prompt mode on the text path", () => {
    const mode = resolveCliExecutionMode({
      prompt: "summarize README.md",
      stdinIsTTY: true,
      stdoutIsTTY: true,
    });

    expect(mode).toBe("single_prompt");
    expect(shouldUseAlternateBuffer(mode)).toBe(false);
  });

  it("keeps non-tty sessions on the text path", () => {
    const mode = resolveCliExecutionMode({
      stdinIsTTY: false,
      stdoutIsTTY: true,
    });

    expect(mode).toBe("interactive_text");
    expect(shouldUseAlternateBuffer(mode)).toBe(false);
  });
});
