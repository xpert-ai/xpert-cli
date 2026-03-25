import { describe, expect, it } from "vitest";
import {
  createInteractiveStreamBuffers,
  flushInteractiveStreamBuffers,
  splitFlushableStreamText,
  streamInteractiveTurnEvent,
} from "../ui/interactive-stream-history.js";

describe("interactive stream history", () => {
  it("streams long assistant text into committed history before turn completion", () => {
    const update = streamInteractiveTurnEvent(createInteractiveStreamBuffers(), {
      type: "assistant_text_delta",
      text: "a".repeat(700),
      sequence: 1,
      at: "2026-03-25T00:00:01.000Z",
    });

    expect(update.items).toEqual([
      {
        type: "assistant_text",
        text: "a".repeat(500),
      },
    ]);
    expect(update.buffers.assistant).toBe("a".repeat(200));
  });

  it("flushes buffered assistant text before tool events so chronology stays intact", () => {
    const buffered = streamInteractiveTurnEvent(createInteractiveStreamBuffers(), {
      type: "assistant_text_delta",
      text: "Planning the change.",
      sequence: 1,
      at: "2026-03-25T00:00:01.000Z",
    });
    const tool = streamInteractiveTurnEvent(buffered.buffers, {
      type: "tool_requested",
      callId: "call-1",
      toolName: "Read",
      argsSummary: "path=README.md",
      target: "README.md",
      sequence: 2,
      at: "2026-03-25T00:00:02.000Z",
    });

    expect(tool.items).toEqual([
      {
        type: "assistant_text",
        text: "Planning the change.",
      },
      {
        type: "tool_call",
        callId: "call-1",
        toolName: "Read",
        target: "README.md",
        argsSummary: "path=README.md",
      },
    ]);
  });

  it("keeps tool, bash, diff, warning, and result items in event order", () => {
    let buffers = createInteractiveStreamBuffers();
    const items: Array<ReturnType<typeof flushInteractiveStreamBuffers>["items"][number]> = [];

    for (const event of [
      {
        type: "tool_requested" as const,
        callId: "call-1",
        toolName: "Bash",
        argsSummary: "command=pnpm test",
        target: "pnpm test",
        sequence: 1,
        at: "2026-03-25T00:00:01.000Z",
      },
      {
        type: "tool_output_line" as const,
        callId: "call-1",
        toolName: "Bash",
        line: "running tests",
        sequence: 2,
        at: "2026-03-25T00:00:02.000Z",
      },
      {
        type: "tool_diff" as const,
        callId: "call-1",
        toolName: "Patch",
        path: "src/app.ts",
        diffText: "@@ -1 +1 @@\n-old\n+new\n",
        sequence: 3,
        at: "2026-03-25T00:00:03.000Z",
      },
      {
        type: "warning" as const,
        callId: "call-1",
        toolName: "Patch",
        message: "context window getting large",
        sequence: 4,
        at: "2026-03-25T00:00:04.000Z",
      },
      {
        type: "error" as const,
        message: "command exited with code 1",
        sequence: 5,
        at: "2026-03-25T00:00:05.000Z",
      },
      {
        type: "tool_completed" as const,
        callId: "call-1",
        toolName: "Bash",
        argsSummary: "command=pnpm test",
        summary: "tests failed",
        status: "error" as const,
        sequence: 6,
        at: "2026-03-25T00:00:06.000Z",
      },
    ]) {
      const update = streamInteractiveTurnEvent(buffers, event);
      buffers = update.buffers;
      items.push(...update.items);
    }

    expect(items).toEqual([
      {
        type: "tool_call",
        callId: "call-1",
        toolName: "Bash",
        target: "pnpm test",
        argsSummary: "command=pnpm test",
      },
      {
        type: "bash_line",
        callId: "call-1",
        toolName: "Bash",
        text: "running tests",
      },
      {
        type: "diff",
        callId: "call-1",
        toolName: "Patch",
        path: "src/app.ts",
        text: "@@ -1 +1 @@\n-old\n+new\n",
      },
      {
        type: "warning",
        callId: "call-1",
        toolName: "Patch",
        code: undefined,
        text: "context window getting large",
      },
      {
        type: "error",
        callId: undefined,
        toolName: undefined,
        code: undefined,
        text: "command exited with code 1",
      },
      {
        type: "tool_result",
        callId: "call-1",
        toolName: "Bash",
        summary: "tests failed",
        status: "error",
      },
    ]);
  });

  it("flushes trailing buffered text when the turn is finalized", () => {
    const buffered = streamInteractiveTurnEvent(createInteractiveStreamBuffers(), {
      type: "assistant_text_delta",
      text: "Final partial answer",
      sequence: 1,
      at: "2026-03-25T00:00:01.000Z",
    });
    const flushed = flushInteractiveStreamBuffers(buffered.buffers);

    expect(flushed.items).toEqual([
      {
        type: "assistant_text",
        text: "Final partial answer",
      },
    ]);
    expect(flushed.buffers).toEqual(createInteractiveStreamBuffers());
  });

  it("does not split assistant output on ordinary newlines before the size threshold", () => {
    const update = streamInteractiveTurnEvent(createInteractiveStreamBuffers(), {
      type: "assistant_text_delta",
      text: "line 1\n\nline 2\n\nline 3",
      sequence: 1,
      at: "2026-03-25T00:00:01.000Z",
    });

    expect(update.items).toEqual([]);
    expect(update.buffers.assistant).toBe("line 1\n\nline 2\n\nline 3");
  });

  it("splits very long stream text near the soft limit", () => {
    expect(splitFlushableStreamText("a".repeat(700))).toEqual({
      flushText: "a".repeat(500),
      remainder: "a".repeat(200),
    });
  });
});
