import type { ResolvedXpertCliConfig } from "@xpert-cli/contracts";
import { describe, expect, it, vi } from "vitest";
import {
  buildInitialInteractiveHistory,
  runInteractiveSlashCommand,
} from "../interactive.js";
import type { CliSessionState } from "../runtime/session-store.js";
import type { ToolRegistry } from "../tools/contracts.js";

describe("interactive inline flow", () => {
  it("replays persisted render transcript into initial committed history", () => {
    const session = createSession({
      turns: [
        {
          turnId: "turn-1",
          prompt: "Read README.md",
          startedAt: "2026-03-25T00:00:01.000Z",
          finishedAt: "2026-03-25T00:00:03.000Z",
          status: "completed",
          toolEvents: [],
          permissionEvents: [],
          changedFiles: [],
          renderItems: [
            {
              type: "user_prompt",
              text: "Read README.md",
            },
            {
              type: "assistant_text",
              text: "Opening README.md",
            },
            {
              type: "tool_call",
              callId: "call-1",
              toolName: "Read",
              target: "README.md",
              argsSummary: "path=README.md",
            },
            {
              type: "tool_result",
              callId: "call-1",
              toolName: "Read",
              summary: "read README.md",
              status: "success",
            },
          ],
        },
      ],
    });

    const initial = buildInitialInteractiveHistory(session);

    expect(initial.batches).toHaveLength(2);
    expect(initial.batches[0]?.blocks[0]).toMatchObject({
      kind: "info",
      text: `xpert session ${session.sessionId}`,
    });
    expect(initial.batches[1]?.blocks).toEqual([
      {
        id: "history-4",
        kind: "user_message",
        text: "Read README.md",
      },
      {
        id: "history-5",
        kind: "assistant_message",
        text: "Opening README.md",
      },
      {
        id: "call:call-1",
        kind: "tool_group",
        toolName: "Read",
        target: "README.md",
        detail: "path=README.md",
        status: "success",
        summary: "read README.md",
        activity: undefined,
      },
    ]);
    expect(initial.nextHistoryIndex).toBe(8);
  });

  it("hides replayed reasoning by default and only includes it when enabled", () => {
    const session = createSession({
      turns: [
        {
          turnId: "turn-1",
          prompt: "Explain the change",
          startedAt: "2026-03-25T00:00:01.000Z",
          finishedAt: "2026-03-25T00:00:03.000Z",
          status: "completed",
          toolEvents: [],
          permissionEvents: [],
          changedFiles: [],
          renderItems: [
            {
              type: "user_prompt",
              text: "Explain the change",
            },
            {
              type: "reasoning",
              text: "private reasoning",
            },
            {
              type: "assistant_text",
              text: "public answer",
            },
          ],
        },
      ],
    });

    const hidden = buildInitialInteractiveHistory(session, {
      includeReasoning: false,
    });
    const shown = buildInitialInteractiveHistory(session, {
      includeReasoning: true,
    });

    expect(hidden.batches[1]?.blocks.map((block) => block.kind)).toEqual([
      "user_message",
      "assistant_message",
    ]);
    expect(shown.batches[1]?.blocks.map((block) => block.kind)).toEqual([
      "user_message",
      "thinking",
      "assistant_message",
    ]);
  });

  it("skips legacy turns without render items and uses the same replay helper for resumed sessions", () => {
    const initial = buildInitialInteractiveHistory(
      createSession({
        turns: [
          {
            turnId: "legacy-turn",
            prompt: "Legacy prompt",
            startedAt: "2026-03-25T00:00:01.000Z",
            finishedAt: "2026-03-25T00:00:02.000Z",
            status: "completed",
            assistantText: "summary only",
            toolEvents: [],
            permissionEvents: [],
            changedFiles: [],
          },
          {
            turnId: "resumed-turn",
            prompt: "Run tests",
            startedAt: "2026-03-25T00:00:03.000Z",
            finishedAt: "2026-03-25T00:00:04.000Z",
            status: "completed",
            toolEvents: [],
            permissionEvents: [],
            changedFiles: [],
            renderItems: [
              {
                type: "user_prompt",
                text: "Run tests",
              },
              {
                type: "warning",
                text: "Turn cancelled",
              },
            ],
          },
        ],
      }),
    );

    expect(initial.batches).toHaveLength(2);
    expect(initial.batches[1]?.blocks).toEqual([
      {
        id: "history-4",
        kind: "user_message",
        text: "Run tests",
      },
      {
        id: "history-5",
        kind: "notice",
        level: "warning",
        scope: "session",
        title: "Session Warning",
        messages: ["Turn cancelled"],
      },
    ]);
  });

  it("normalizes unresolved replayed tool activity to idle instead of showing it as running", () => {
    const initial = buildInitialInteractiveHistory(
      createSession({
        turns: [
          {
            turnId: "turn-1",
            prompt: "Run tests",
            startedAt: "2026-03-25T00:00:03.000Z",
            finishedAt: "2026-03-25T00:00:04.000Z",
            status: "completed",
            toolEvents: [],
            permissionEvents: [],
            changedFiles: [],
            renderItems: [
              {
                type: "user_prompt",
                text: "Run tests",
              },
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
                text: "failing test output",
              },
            ],
          },
        ],
      }),
    );

    expect(initial.batches[1]?.blocks).toEqual([
      {
        id: "history-4",
        kind: "user_message",
        text: "Run tests",
      },
      {
        id: "call:call-1",
        kind: "tool_group",
        toolName: "Bash",
        target: "pnpm test",
        detail: "command=pnpm test",
        status: "idle",
        summary: undefined,
        activity: "1 bash line",
      },
      {
        id: "call:call-1:bash",
        kind: "bash_output",
        title: "Bash · pnpm test",
        status: "idle",
        summary: undefined,
        lines: ["failing test output"],
        hiddenLineCount: 0,
      },
    ]);
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
      title: "Local Status · /status",
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
