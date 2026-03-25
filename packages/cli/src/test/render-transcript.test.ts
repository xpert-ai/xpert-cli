import { describe, expect, it } from "vitest";
import {
  filterPersistedTurnRenderItemsForReplay,
  hydrateTurnRenderItems,
  RENDER_TRANSCRIPT_LIMITS,
  sanitizePersistedTurnRenderItems,
} from "../runtime/render-transcript.js";

describe("render transcript", () => {
  it("treats missing or legacy render items as empty", () => {
    expect(sanitizePersistedTurnRenderItems(undefined)).toEqual([]);
    expect(sanitizePersistedTurnRenderItems({})).toEqual([]);
  });

  it("clips oversized content and caps per-type item counts", () => {
    const items = sanitizePersistedTurnRenderItems([
      {
        type: "user_prompt",
        text: "prompt ".repeat(400),
      },
      {
        type: "assistant_text",
        text: "assistant ".repeat(500),
      },
      ...Array.from(
        { length: RENDER_TRANSCRIPT_LIMITS.bashLinesPerTurn + 5 },
        (_, index) => ({
          type: "bash_line" as const,
          callId: "call-1",
          toolName: "Bash",
          text: `${index} ${"x".repeat(RENDER_TRANSCRIPT_LIMITS.bashLineChars + 50)}`,
        }),
      ),
      ...Array.from(
        { length: RENDER_TRANSCRIPT_LIMITS.diffBlocksPerTurn + 3 },
        (_, index) => ({
          type: "diff" as const,
          callId: `call-${index}`,
          toolName: "Patch",
          path: `src/file-${index}.ts`,
          text: `diff --git a/src/file-${index}.ts b/src/file-${index}.ts\n${"+line\n".repeat(2000)}`,
        }),
      ),
      ...Array.from(
        { length: RENDER_TRANSCRIPT_LIMITS.warningCountPerTurn + 2 },
        (_, index) => ({
          type: "warning" as const,
          text: `warning ${index} ${"x".repeat(RENDER_TRANSCRIPT_LIMITS.noticeChars + 30)}`,
        }),
      ),
    ]);

    expect(items.find((item) => item.type === "user_prompt")).toMatchObject({
      type: "user_prompt",
    });
    expect(
      items.find((item) => item.type === "assistant_text" && item.text.length > 0),
    ).toBeDefined();
    expect(
      items.filter((item) => item.type === "bash_line"),
    ).toHaveLength(RENDER_TRANSCRIPT_LIMITS.bashLinesPerTurn);
    expect(
      items.filter((item) => item.type === "diff"),
    ).toHaveLength(RENDER_TRANSCRIPT_LIMITS.diffBlocksPerTurn);
    expect(
      items.filter((item) => item.type === "warning").length,
    ).toBeLessThanOrEqual(RENDER_TRANSCRIPT_LIMITS.warningCountPerTurn + 1);
    expect(
      items.some(
        (item) =>
          item.type === "warning" &&
          item.code === "TRANSCRIPT_TRUNCATED" &&
          item.text.includes("bash output clipped"),
      ),
    ).toBe(true);

    for (const item of items) {
      if (item.type === "user_prompt") {
        expect(item.text.length).toBeLessThanOrEqual(
          RENDER_TRANSCRIPT_LIMITS.userPromptChars,
        );
      }
      if (item.type === "assistant_text") {
        expect(item.text.length).toBeLessThanOrEqual(
          RENDER_TRANSCRIPT_LIMITS.assistantChars,
        );
      }
      if (item.type === "bash_line") {
        expect(item.text.length).toBeLessThanOrEqual(
          RENDER_TRANSCRIPT_LIMITS.bashLineChars,
        );
      }
      if (item.type === "diff") {
        expect(item.text.length).toBeLessThanOrEqual(RENDER_TRANSCRIPT_LIMITS.diffChars);
      }
    }
  });

  it("caps the total item count per turn and preserves replayability", () => {
    const items = sanitizePersistedTurnRenderItems([
      {
        type: "user_prompt",
        text: "Run all checks",
      },
      ...Array.from({ length: RENDER_TRANSCRIPT_LIMITS.maxItemsPerTurn + 20 }, (_, index) => ({
        type: "assistant_text" as const,
        text: `segment ${index}`,
      })),
    ]);

    expect(items.length).toBeLessThanOrEqual(RENDER_TRANSCRIPT_LIMITS.maxItemsPerTurn);
    expect(items[0]).toMatchObject({
      type: "user_prompt",
      text: "Run all checks",
    });
    expect(items.at(-1)).toMatchObject({
      type: "warning",
      code: "TRANSCRIPT_TRUNCATED",
    });
  });

  it("preserves bash-line whitespace instead of collapsing indentation", () => {
    const [item] = sanitizePersistedTurnRenderItems([
      {
        type: "bash_line",
        toolName: "Bash",
        text: "  col1\tcol2  value",
      },
    ]);

    expect(item).toEqual({
      type: "bash_line",
      callId: undefined,
      toolName: "Bash",
      text: "  col1\tcol2  value",
    });
  });

  it("hydrates persisted items back into UI history with new local ids", () => {
    let index = 0;
    const history = hydrateTurnRenderItems(
      [
        {
          type: "user_prompt",
          text: "Read README.md",
        },
        {
          type: "tool_result",
          toolName: "Read",
          summary: "read README.md",
          status: "success",
        },
      ],
      () => `history-${++index}`,
    );

    expect(history).toEqual([
      {
        id: "history-1",
        type: "user_prompt",
        text: "Read README.md",
      },
      {
        id: "history-2",
        type: "tool_result",
        toolName: "Read",
        summary: "read README.md",
        status: "success",
      },
    ]);
  });

  it("filters reasoning from replay unless explicitly enabled", () => {
    expect(
      filterPersistedTurnRenderItemsForReplay(
        [
          {
            type: "reasoning",
            text: "private chain",
          },
          {
            type: "assistant_text",
            text: "public answer",
          },
        ],
        {
          includeReasoning: false,
        },
      ),
    ).toEqual([
      {
        type: "assistant_text",
        text: "public answer",
      },
    ]);

    expect(
      filterPersistedTurnRenderItemsForReplay(
        [
          {
            type: "reasoning",
            text: "private chain",
          },
        ],
        {
          includeReasoning: true,
        },
      ),
    ).toEqual([
      {
        type: "reasoning",
        text: "private chain",
      },
    ]);
  });
});
