import { describe, expect, it } from "vitest";
import {
  buildToolCallSignature,
  MAX_CONSECUTIVE_IDENTICAL_TOOL_CALLS,
  ToolCallGuard,
} from "../runtime/tool-call-guard.js";

describe("ToolCallGuard", () => {
  it("reuses cached messages for duplicate call ids", () => {
    const guard = new ToolCallGuard();
    const message = {
      tool_call_id: "call-1",
      name: "Read",
      content: "cached",
      status: "success" as const,
    };

    guard.remember("call-1", message);

    expect(
      guard.begin({
        callId: "call-1",
        toolName: "Read",
        args: { path: "README.md" },
      }),
    ).toEqual({
      kind: "duplicate",
      message,
    });
  });

  it("blocks identical tool calls after the configured limit", () => {
    const guard = new ToolCallGuard();

    for (let index = 0; index < MAX_CONSECUTIVE_IDENTICAL_TOOL_CALLS; index += 1) {
      expect(
        guard.begin({
          callId: `call-${index}`,
          toolName: "Bash",
          args: { command: "pwd" },
        }),
      ).toEqual({ kind: "execute" });
    }

    expect(
      guard.begin({
        callId: "call-blocked",
        toolName: "Bash",
        args: { command: "pwd" },
      }),
    ).toEqual({
      kind: "blocked",
      reason: `Blocked repeated Bash call after ${MAX_CONSECUTIVE_IDENTICAL_TOOL_CALLS + 1} identical requests in a row`,
    });
  });

  it("resets the repeat counter when the tool signature changes", () => {
    const guard = new ToolCallGuard();

    expect(
      guard.begin({
        callId: "call-1",
        toolName: "Read",
        args: { path: "README.md" },
      }),
    ).toEqual({ kind: "execute" });
    expect(
      guard.begin({
        callId: "call-2",
        toolName: "Read",
        args: { path: "README.md" },
      }),
    ).toEqual({ kind: "execute" });
    expect(
      guard.begin({
        callId: "call-3",
        toolName: "Read",
        args: { path: "PLAN.md" },
      }),
    ).toEqual({ kind: "execute" });
  });
});

describe("buildToolCallSignature", () => {
  it("stabilizes object key order", () => {
    expect(
      buildToolCallSignature("Patch", {
        newString: "b",
        oldString: "a",
        path: "src/demo.ts",
      }),
    ).toBe(
      buildToolCallSignature("Patch", {
        path: "src/demo.ts",
        oldString: "a",
        newString: "b",
      }),
    );
  });
});
