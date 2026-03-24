import { describe, expect, it } from "vitest";
import { createUnifiedDiff } from "../ui/diff.js";
import {
  buildPendingTurnViewModel,
  buildDiffPreview,
} from "../ui/pending-view.js";
import { applyTurnEvent } from "../ui/ink-state.js";
import { createEmptyPendingTurn } from "../ui/history.js";

describe("buildPendingTurnViewModel", () => {
  it("splits assistant text, tool activity, bash, diff, warnings, and errors", () => {
    let pending = createEmptyPendingTurn();
    const diff = createUnifiedDiff(
      "src/app.ts",
      "export const value = 1;\n",
      "export const value = 2;\n",
    );

    pending = applyTurnEvent(pending, {
      type: "assistant_text_delta",
      text: "Planning the changes.",
      sequence: 1,
      at: "2026-03-24T00:00:01.000Z",
    });
    pending = applyTurnEvent(pending, {
      type: "tool_requested",
      callId: "call-read",
      toolName: "Read",
      argsSummary: "path=src/app.ts",
      target: "src/app.ts",
      sequence: 2,
      at: "2026-03-24T00:00:02.000Z",
    });
    pending = applyTurnEvent(pending, {
      type: "tool_completed",
      callId: "call-read",
      toolName: "Read",
      argsSummary: "path=src/app.ts",
      summary: "read src/app.ts",
      status: "success",
      sequence: 3,
      at: "2026-03-24T00:00:03.000Z",
    });
    pending = applyTurnEvent(pending, {
      type: "tool_requested",
      callId: "call-bash",
      toolName: "Bash",
      argsSummary: "command=pnpm test",
      target: "pnpm test",
      sequence: 4,
      at: "2026-03-24T00:00:04.000Z",
    });
    pending = applyTurnEvent(pending, {
      type: "tool_output_line",
      callId: "call-bash",
      toolName: "Bash",
      line: "stdout line 1",
      sequence: 5,
      at: "2026-03-24T00:00:05.000Z",
    });
    pending = applyTurnEvent(pending, {
      type: "tool_output_line",
      callId: "call-bash",
      toolName: "Bash",
      line: "stdout line 2",
      sequence: 6,
      at: "2026-03-24T00:00:06.000Z",
    });
    pending = applyTurnEvent(pending, {
      type: "tool_completed",
      callId: "call-bash",
      toolName: "Bash",
      argsSummary: "command=pnpm test",
      summary: "exit 0",
      status: "success",
      sequence: 7,
      at: "2026-03-24T00:00:07.000Z",
    });
    pending = applyTurnEvent(pending, {
      type: "tool_requested",
      callId: "call-patch",
      toolName: "Patch",
      argsSummary: "path=src/app.ts",
      target: "src/app.ts",
      sequence: 8,
      at: "2026-03-24T00:00:08.000Z",
    });
    pending = applyTurnEvent(pending, {
      type: "tool_diff",
      callId: "call-patch",
      toolName: "Patch",
      path: "src/app.ts",
      diffText: diff,
      sequence: 9,
      at: "2026-03-24T00:00:09.000Z",
    });
    pending = applyTurnEvent(pending, {
      type: "warning",
      message: "global warning",
      sequence: 10,
      at: "2026-03-24T00:00:10.000Z",
    });
    pending = applyTurnEvent(pending, {
      type: "error",
      callId: "call-patch",
      toolName: "Patch",
      message: "patch failed",
      code: "TOOL_EXECUTION_ERROR",
      sequence: 11,
      at: "2026-03-24T00:00:11.000Z",
    });
    pending = applyTurnEvent(pending, {
      type: "tool_completed",
      callId: "call-patch",
      toolName: "Patch",
      argsSummary: "path=src/app.ts",
      summary: "Patch failed for src/app.ts",
      status: "error",
      code: "TOOL_EXECUTION_ERROR",
      sequence: 12,
      at: "2026-03-24T00:00:12.000Z",
    });

    const viewModel = buildPendingTurnViewModel(pending);

    expect(viewModel.assistant?.text).toContain("Planning the changes.");
    expect(viewModel.toolCards.map((tool) => [tool.toolName, tool.status])).toEqual([
      ["Read", "success"],
      ["Bash", "success"],
      ["Patch", "error"],
    ]);
    expect(viewModel.bashBlocks).toHaveLength(1);
    expect(viewModel.bashBlocks[0]).toMatchObject({
      title: "Bash · pnpm test",
      summary: "exit 0",
      lines: ["stdout line 1", "stdout line 2"],
    });
    expect(viewModel.diffBlocks).toHaveLength(1);
    expect(viewModel.diffBlocks[0]?.files[0]).toMatchObject({
      path: "src/app.ts",
    });
    expect(viewModel.warnings.map((notice) => notice.message)).toEqual([
      "global warning",
    ]);
    expect(viewModel.errors.map((notice) => notice.message)).toEqual([
      "patch failed",
    ]);
  });

  it("clips long bash and diff previews without flattening multiple tool calls together", () => {
    let pending = createEmptyPendingTurn();
    const diff = createUnifiedDiff(
      "src/long.ts",
      [
        "one",
        "two",
        "three",
        "four",
        "five",
      ].join("\n") + "\n",
      [
        "one",
        "two changed",
        "three changed",
        "four changed",
        "five changed",
      ].join("\n") + "\n",
    );

    pending = applyTurnEvent(pending, {
      type: "tool_requested",
      callId: "call-a",
      toolName: "Bash",
      argsSummary: "command=printf",
      target: "printf",
      sequence: 1,
      at: "2026-03-24T00:00:01.000Z",
    });
    for (let index = 1; index <= 5; index += 1) {
      pending = applyTurnEvent(pending, {
        type: "tool_output_line",
        callId: "call-a",
        toolName: "Bash",
        line: `line ${index}`,
        sequence: index + 1,
        at: `2026-03-24T00:00:0${index + 1}.000Z`,
      });
    }
    pending = applyTurnEvent(pending, {
      type: "tool_completed",
      callId: "call-a",
      toolName: "Bash",
      argsSummary: "command=printf",
      summary: "exit 0",
      status: "success",
      sequence: 7,
      at: "2026-03-24T00:00:07.000Z",
    });
    pending = applyTurnEvent(pending, {
      type: "tool_requested",
      callId: "call-b",
      toolName: "Patch",
      argsSummary: "path=src/long.ts",
      target: "src/long.ts",
      sequence: 8,
      at: "2026-03-24T00:00:08.000Z",
    });
    pending = applyTurnEvent(pending, {
      type: "tool_diff",
      callId: "call-b",
      toolName: "Patch",
      path: "src/long.ts",
      diffText: diff,
      sequence: 9,
      at: "2026-03-24T00:00:09.000Z",
    });
    pending = applyTurnEvent(pending, {
      type: "tool_completed",
      callId: "call-b",
      toolName: "Patch",
      argsSummary: "path=src/long.ts",
      summary: "src/long.ts +4 -4",
      status: "success",
      sequence: 10,
      at: "2026-03-24T00:00:10.000Z",
    });

    const viewModel = buildPendingTurnViewModel(pending, {
      maxBashLinesPerBlock: 2,
      maxDiffLinesPerFile: 3,
    });

    expect(viewModel.toolCards.map((tool) => tool.toolName)).toEqual([
      "Bash",
      "Patch",
    ]);
    expect(viewModel.bashBlocks[0]).toMatchObject({
      lines: ["line 4", "line 5"],
      hiddenLineCount: 3,
    });
    expect(viewModel.diffBlocks[0]?.files[0]?.lines).toHaveLength(3);
    expect(viewModel.diffBlocks[0]?.files[0]?.hiddenLineCount).toBeGreaterThan(0);
  });

  it("preserves assistant spacing when tool activity interrupts streaming text", () => {
    let pending = createEmptyPendingTurn();

    pending = applyTurnEvent(pending, {
      type: "assistant_text_delta",
      text: "Hello ",
      sequence: 1,
      at: "2026-03-24T00:00:01.000Z",
    });
    pending = applyTurnEvent(pending, {
      type: "tool_requested",
      callId: "call-1",
      toolName: "Read",
      argsSummary: "path=README.md",
      target: "README.md",
      sequence: 2,
      at: "2026-03-24T00:00:02.000Z",
    });
    pending = applyTurnEvent(pending, {
      type: "tool_completed",
      callId: "call-1",
      toolName: "Read",
      argsSummary: "path=README.md",
      summary: "read README.md",
      status: "success",
      sequence: 3,
      at: "2026-03-24T00:00:03.000Z",
    });
    pending = applyTurnEvent(pending, {
      type: "assistant_text_delta",
      text: "world",
      sequence: 4,
      at: "2026-03-24T00:00:04.000Z",
    });

    const viewModel = buildPendingTurnViewModel(pending);

    expect(viewModel.assistant?.text).toBe("Hello world");
  });

  it("keeps global warnings and errors out of the previous tool card", () => {
    let pending = createEmptyPendingTurn();

    pending = applyTurnEvent(pending, {
      type: "tool_requested",
      callId: "call-bash",
      toolName: "Bash",
      argsSummary: "command=pnpm test",
      target: "pnpm test",
      sequence: 1,
      at: "2026-03-24T00:00:01.000Z",
    });
    pending = applyTurnEvent(pending, {
      type: "tool_completed",
      callId: "call-bash",
      toolName: "Bash",
      argsSummary: "command=pnpm test",
      summary: "exit 0",
      status: "success",
      sequence: 2,
      at: "2026-03-24T00:00:02.000Z",
    });
    pending = applyTurnEvent(pending, {
      type: "warning",
      message: "global warning",
      sequence: 3,
      at: "2026-03-24T00:00:03.000Z",
    });
    pending = applyTurnEvent(pending, {
      type: "error",
      message: "global error",
      sequence: 4,
      at: "2026-03-24T00:00:04.000Z",
    });

    const viewModel = buildPendingTurnViewModel(pending);

    expect(viewModel.toolCards).toHaveLength(1);
    expect(viewModel.toolCards[0]).toMatchObject({
      toolName: "Bash",
      summary: "exit 0",
      activity: undefined,
    });
    expect(viewModel.warnings.map((notice) => notice.message)).toEqual([
      "global warning",
    ]);
    expect(viewModel.errors.map((notice) => notice.message)).toEqual([
      "global error",
    ]);
  });
});

describe("buildDiffPreview", () => {
  it("keeps file paths and diff line kinds separate", () => {
    const diff = createUnifiedDiff(
      "src/demo.ts",
      "const a = 1;\n",
      "const a = 2;\n",
    );

    const preview = buildDiffPreview(diff, {
      path: "src/demo.ts",
      maxLinesPerFile: 8,
    });

    expect(preview.files[0]?.path).toBe("src/demo.ts");
    expect(preview.files[0]?.lines.map((line) => line.kind)).toContain("remove");
    expect(preview.files[0]?.lines.map((line) => line.kind)).toContain("add");
    expect(preview.files[0]?.lines.map((line) => line.kind)).toContain("hunk");
  });
});
