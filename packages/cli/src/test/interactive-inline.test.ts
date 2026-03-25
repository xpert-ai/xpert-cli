import type { ResolvedXpertCliConfig } from "@xpert-cli/contracts";
import { describe, expect, it, vi } from "vitest";
import {
  createInteractiveStreamBuffers,
  flushInteractiveStreamBuffers,
  runInteractiveSlashCommand,
  splitFlushableStreamText,
  streamInteractiveTurnEvent,
} from "../interactive.js";
import type { CliSessionState } from "../runtime/session-store.js";
import type { ToolRegistry } from "../tools/contracts.js";

describe("interactive inline flow", () => {
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

  it("flushes buffered assistant text before tool events so scrollback keeps chronological order", () => {
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

  it("forces interactive slash commands down the inline history path", async () => {
    const effect = await runInteractiveSlashCommand("/status", {
      config: createConfig(),
      session: createSession(),
      toolRegistry: createToolRegistry(),
      deps: {
        buildRunLocalContext: vi.fn().mockResolvedValue({
          cwd: "/tmp/project",
          projectRoot: "/tmp/project",
          xpertMd: { available: false, truncated: false },
          git: {
            available: true,
            isRepo: true,
            statusShort: "",
            truncated: false,
          },
          workingSet: {
            recentFiles: [],
            recentToolCalls: [],
          },
        }),
      },
    });

    expect(effect.shouldExit).toBe(false);
    expect(effect.historyItems).toHaveLength(1);
    expect(effect.historyItems[0]).toMatchObject({
      type: "status_view",
      title: "Status",
    });
  });

  it("splits very long stream text near the soft limit", () => {
    expect(splitFlushableStreamText("a".repeat(700))).toEqual({
      flushText: "a".repeat(500),
      remainder: "a".repeat(200),
    });
  });
});

function createConfig(): ResolvedXpertCliConfig {
  return {
    apiUrl: "http://localhost:3000/api/ai",
    apiKey: "test-key",
    assistantId: "assistant-1",
    defaultModel: "gpt-5.4",
    organizationId: undefined,
    approvalMode: "default",
    sandboxMode: "host",
    projectRoot: "/tmp/project",
    cwd: "/tmp/project",
    userConfigDir: "/tmp/.xpert-cli",
    userConfigPath: "/tmp/.xpert-cli/config.json",
    projectConfigPath: "/tmp/project/.xpert-cli.json",
    xpertMdPath: undefined,
    xpertMdContent: undefined,
  };
}

function createSession(
  overrides?: Partial<CliSessionState>,
): CliSessionState {
  const now = "2026-03-25T00:00:00.000Z";
  return {
    sessionId: overrides?.sessionId ?? "session-1",
    assistantId: overrides?.assistantId ?? "assistant-1",
    threadId: overrides?.threadId,
    runId: overrides?.runId,
    checkpointId: overrides?.checkpointId,
    cwd: overrides?.cwd ?? "/tmp/project",
    projectRoot: overrides?.projectRoot ?? "/tmp/project",
    recentFiles: overrides?.recentFiles ?? [],
    recentToolCalls: overrides?.recentToolCalls ?? [],
    approvals: overrides?.approvals ?? [],
    turns: overrides?.turns ?? [],
    createdAt: overrides?.createdAt ?? now,
    updatedAt: overrides?.updatedAt ?? now,
  };
}

function createToolRegistry(): ToolRegistry {
  return {
    tools: new Map([
      [
        "Read",
        {
          name: "Read",
          description: "Read a file from the local project with line numbers.",
          schema: {},
          execute: vi.fn(),
        },
      ],
    ]),
    clientTools: [],
  };
}
