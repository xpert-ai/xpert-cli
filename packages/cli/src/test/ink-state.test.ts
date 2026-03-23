import { describe, expect, it } from "vitest";
import {
  getNextTurnLifecycleState,
  type TurnLifecycleState,
} from "../runtime/turn-events.js";
import { applyTurnEvent } from "../ui/ink-state.js";
import {
  createEmptyPendingTurn,
  materializePendingTurn,
} from "../ui/history.js";

describe("Ink UI state mapping", () => {
  it("preserves chronological event order for pending and history entries", () => {
    let pending = createEmptyPendingTurn();

    pending = applyTurnEvent(pending, {
      type: "assistant_text_delta",
      text: "Planning",
      sequence: 1,
      at: "2026-03-23T00:00:01.000Z",
    });
    pending = applyTurnEvent(pending, {
      type: "assistant_text_delta",
      text: " the change.",
      sequence: 2,
      at: "2026-03-23T00:00:02.000Z",
    });
    pending = applyTurnEvent(pending, {
      type: "tool_requested",
      callId: "call-1",
      toolName: "Read",
      argsSummary: "path=src/index.ts",
      target: "src/index.ts",
      sequence: 3,
      at: "2026-03-23T00:00:03.000Z",
    });
    pending = applyTurnEvent(pending, {
      type: "tool_output_line",
      callId: "call-1",
      toolName: "Read",
      line: "1 | export const value = 1;",
      sequence: 4,
      at: "2026-03-23T00:00:04.000Z",
    });
    pending = applyTurnEvent(pending, {
      type: "tool_completed",
      callId: "call-1",
      toolName: "Read",
      argsSummary: "path=src/index.ts",
      summary: "read src/index.ts",
      status: "success",
      sequence: 5,
      at: "2026-03-23T00:00:05.000Z",
    });
    pending = applyTurnEvent(pending, {
      type: "assistant_text_delta",
      text: "Inspecting tool output.",
      sequence: 6,
      at: "2026-03-23T00:00:06.000Z",
    });

    expect(pending.entries).toEqual([
      { type: "assistant_text", text: "Planning the change." },
      { type: "tool_call", toolName: "Read", target: "src/index.ts" },
      { type: "bash_line", text: "1 | export const value = 1;" },
      { type: "tool_result", toolName: "Read", summary: "read src/index.ts" },
      { type: "assistant_text", text: "Inspecting tool output." },
    ]);

    let counter = 0;
    const history = materializePendingTurn(pending, () => `item-${++counter}`);

    expect(history).toEqual([
      {
        id: "item-1",
        type: "assistant_text",
        text: "Planning the change.",
      },
      {
        id: "item-2",
        type: "tool_call",
        toolName: "Read",
        target: "src/index.ts",
      },
      {
        id: "item-3",
        type: "bash_line",
        text: "1 | export const value = 1;",
      },
      {
        id: "item-4",
        type: "tool_result",
        toolName: "Read",
        summary: "read src/index.ts",
      },
      {
        id: "item-5",
        type: "assistant_text",
        text: "Inspecting tool output.",
      },
    ]);
  });

  it("keeps permission wait ownership out of the runtime lifecycle", () => {
    let state: TurnLifecycleState = "running";

    state = getNextTurnLifecycleState(state, {
      type: "permission_requested",
      callId: "call-1",
      toolName: "Patch",
      riskLevel: "moderate",
      scope: "Patch src/app.ts",
      sequence: 1,
      at: "2026-03-23T00:00:01.000Z",
    });
    expect(state).toBe("running");

    state = getNextTurnLifecycleState(state, {
      type: "permission_resolved",
      callId: "call-1",
      toolName: "Patch",
      riskLevel: "moderate",
      scope: "Patch src/app.ts",
      allowed: true,
      decision: "allow_once",
      sequence: 2,
      at: "2026-03-23T00:00:02.000Z",
    });
    expect(state).toBe("running");

    state = getNextTurnLifecycleState(state, {
      type: "turn_finished",
      status: "cancelled",
      cancelled: true,
      sequence: 3,
      at: "2026-03-23T00:00:03.000Z",
    });
    expect(state).toBe("cancelled");
  });

  it("keeps stale-thread retry warnings out of Ink pending history", () => {
    let pending = createEmptyPendingTurn();

    pending = applyTurnEvent(pending, {
      type: "warning",
      message: "previous remote thread was not found; retrying with a new thread",
      code: "STALE_THREAD_RETRY",
      sequence: 1,
      at: "2026-03-23T00:00:01.000Z",
    });

    expect(pending.entries).toEqual([]);
  });
});
