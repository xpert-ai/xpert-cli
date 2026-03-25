import { describe, expect, it } from "vitest";
import { createUnifiedDiff } from "../ui/diff.js";
import {
  buildHistoryRenderBlocks,
  buildPendingRenderBlocks,
  buildOverlayRenderBlocks,
  createCommittedRenderBatch,
} from "../ui/render-blocks.js";
import { createEmptyPendingTurn } from "../ui/history.js";
import { applyTurnEvent } from "../ui/ink-state.js";
import { renderBlockRows } from "../ui/ink/blocks.js";

describe("render block model", () => {
  it("converts history into user, assistant, tool, bash, diff, and notice blocks", () => {
    const diff = createUnifiedDiff(
      "src/app.ts",
      "export const value = 1;\n",
      "export const value = 2;\n",
    );
    const blocks = buildHistoryRenderBlocks([
      { id: "1", type: "user_prompt", text: "Inspect src/app.ts" },
      { id: "2", type: "assistant_text", text: "Reading the file." },
      {
        id: "3",
        type: "tool_call",
        callId: "call-1",
        toolName: "Read",
        target: "src/app.ts",
        argsSummary: "path=src/app.ts",
      },
      {
        id: "4",
        type: "bash_line",
        callId: "call-1",
        toolName: "Read",
        text: "1 | export const value = 1;",
      },
      {
        id: "5",
        type: "diff",
        callId: "call-1",
        toolName: "Patch",
        path: "src/app.ts",
        text: diff,
      },
      {
        id: "6",
        type: "warning",
        callId: "call-1",
        toolName: "Patch",
        text: "patch warning",
      },
      {
        id: "7",
        type: "tool_result",
        callId: "call-1",
        toolName: "Read",
        summary: "read src/app.ts",
        status: "success",
      },
    ]);

    expect(blocks.map((block) => block.kind)).toEqual([
      "user_message",
      "assistant_message",
      "tool_group",
      "bash_output",
      "diff_preview",
      "notice",
    ]);
    expect(blocks.find((block) => block.kind === "diff_preview")).toMatchObject({
      kind: "diff_preview",
      files: [{ path: "src/app.ts" }],
    });
  });

  it("keeps assistant streaming text natural even when tool activity interrupts it", () => {
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
      type: "assistant_text_delta",
      text: "world",
      sequence: 3,
      at: "2026-03-24T00:00:03.000Z",
    });

    const blocks = buildPendingRenderBlocks(pending);

    expect(blocks[0]).toMatchObject({
      kind: "assistant_message",
      text: "Hello world",
    });
    expect(blocks[1]).toMatchObject({
      kind: "tool_group",
      toolName: "Read",
    });
  });

  it("keeps tool-scoped and session-scoped notices separate", () => {
    let pending = createEmptyPendingTurn();

    pending = applyTurnEvent(pending, {
      type: "warning",
      callId: "call-1",
      toolName: "Patch",
      message: "tool warning",
      sequence: 1,
      at: "2026-03-24T00:00:01.000Z",
    });
    pending = applyTurnEvent(pending, {
      type: "error",
      message: "session error",
      sequence: 2,
      at: "2026-03-24T00:00:02.000Z",
    });

    const notices = buildPendingRenderBlocks(pending).filter(
      (block) => block.kind === "notice",
    );

    expect(notices).toEqual([
      expect.objectContaining({
        kind: "notice",
        scope: "tool",
        messages: ["tool warning"],
      }),
      expect.objectContaining({
        kind: "notice",
        scope: "session",
        messages: ["session error"],
      }),
    ]);
  });

  it("converts overlay panel sections into pager blocks without polluting transcript history", () => {
    const blocks = buildOverlayRenderBlocks({
      panel: "session",
      title: "Session",
      sections: [
        {
          title: "Recent Turns",
          lines: ["COMPLETED turn=abcd1234", "prompt: summarize cli.ts"],
        },
      ],
    });

    expect(blocks).toEqual([
      {
        id: "session:0",
        kind: "section",
        title: "Recent Turns",
        lines: ["COMPLETED turn=abcd1234", "prompt: summarize cli.ts"],
      },
    ]);
  });

  it("renders committed blocks with stable prefixes and preserves bash whitespace", () => {
    const blocks = buildHistoryRenderBlocks([
      {
        id: "status-1",
        type: "status_view",
        title: "Local Status · /status",
        lines: ["Runtime:", "cwd: /tmp/project", "- Read: file contents"],
      },
      {
        id: "tool-1",
        type: "tool_call",
        callId: "call-1",
        toolName: "Bash",
        target: "pnpm test",
        argsSummary: "command=pnpm test",
      },
      {
        id: "tool-2",
        type: "bash_line",
        callId: "call-1",
        toolName: "Bash",
        text: "  aligned output",
      },
      {
        id: "tool-3",
        type: "warning",
        callId: "call-1",
        toolName: "Bash",
        code: "EXIT_NONZERO",
        text: "tests failed",
      },
      {
        id: "tool-4",
        type: "tool_result",
        callId: "call-1",
        toolName: "Bash",
        summary: "exit 1",
        status: "error",
      },
    ]);

    const sectionRows = renderBlockRows(blocks[0]!, 60).map((row) => row.text);
    const toolRows = renderBlockRows(blocks[1]!, 60).map((row) => row.text);
    const bashRows = renderBlockRows(blocks[2]!, 60).map((row) => row.text);
    const noticeRows = renderBlockRows(blocks[3]!, 60).map((row) => row.text);

    expect(sectionRows).toEqual([
      "Local Status · /status",
      "Runtime",
      "│ cwd: /tmp/project",
      "│ - Read: file contents",
      "",
    ]);
    expect(toolRows.join("\n")).toContain("Tool · Bash · pnpm test · error");
    expect(toolRows.join("\n")).toContain("│ args:");
    expect(toolRows.join("\n")).toContain("│ result:");
    expect(bashRows).toContain("│   aligned output");
    expect(noticeRows[0]).toContain("Bash Warning · [EXIT_NONZERO]");
    expect(noticeRows).not.toContain("│ scope:");
  });

  it("creates append-only committed batches from materialized history items", () => {
    const batch = createCommittedRenderBatch([
      { id: "1", type: "user_prompt", text: "Inspect src/app.ts" },
      { id: "2", type: "assistant_text", text: "Reading the file." },
    ]);

    expect(batch).toEqual({
      id: "batch:1",
      blocks: [
        {
          id: "1",
          kind: "user_message",
          text: "Inspect src/app.ts",
        },
        {
          id: "2",
          kind: "assistant_message",
          text: "Reading the file.",
        },
      ],
    });
  });
});
