import { describe, expect, it } from "vitest";
import { ToolCallGuard } from "../runtime/tool-call-guard.js";

describe("ToolCallGuard", () => {
  it("ignores a repeated stream event for the same call id", () => {
    const guard = new ToolCallGuard();

    expect(
      guard.begin({
        callId: "call-1",
        toolName: "Bash",
        args: { command: "pwd" },
      }),
    ).toEqual({ kind: "execute" });

    guard.remember("call-1", {
      tool_call_id: "call-1",
      name: "Bash",
      content: "/tmp/project",
    });

    expect(
      guard.begin({
        callId: "call-1",
        toolName: "Bash",
        args: { command: "pwd" },
      }),
    ).toEqual({ kind: "already_handled" });
  });
});
