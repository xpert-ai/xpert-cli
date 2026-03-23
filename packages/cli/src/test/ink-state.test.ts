import { describe, expect, it } from "vitest";
import { applyUiEvent } from "../ui/ink-state.js";
import {
  createEmptyPendingTurn,
  materializePendingTurn,
} from "../ui/history.js";

describe("Ink UI state mapping", () => {
  it("preserves chronological event order while coalescing adjacent assistant text", () => {
    let pending = createEmptyPendingTurn();

    pending = applyUiEvent(pending, {
      type: "assistant_text",
      text: "Planning",
    });
    pending = applyUiEvent(pending, {
      type: "assistant_text",
      text: " the change.",
    });
    pending = applyUiEvent(pending, {
      type: "tool_call",
      toolName: "Read",
      target: "src/index.ts",
    });
    pending = applyUiEvent(pending, {
      type: "assistant_text",
      text: "Inspecting tool output.",
    });
    pending = applyUiEvent(pending, {
      type: "tool_ack",
      toolName: "Read",
      summary: "read src/index.ts",
    });

    expect(pending.items).toEqual([
      { type: "assistant_text", text: "Planning the change." },
      { type: "tool_call", toolName: "Read", target: "src/index.ts" },
      { type: "assistant_text", text: "Inspecting tool output." },
      { type: "tool_result", toolName: "Read", summary: "read src/index.ts" },
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
        type: "assistant_text",
        text: "Inspecting tool output.",
      },
      {
        id: "item-4",
        type: "tool_result",
        toolName: "Read",
        summary: "read src/index.ts",
      },
    ]);
  });
});
