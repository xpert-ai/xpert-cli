import type { ResolvedXpertCliConfig } from "@xpert-cli/contracts";
import { describe, expect, it, vi } from "vitest";
import { runSlashCommand } from "../ui/commands.js";
import type { CliSessionState } from "../runtime/session-store.js";
import type { ToolRegistry } from "../tools/contracts.js";

describe("slash commands", () => {
  it("renders /status from local runtime state without calling the model", async () => {
    const result = await runSlashCommand("/status", {
      config: createConfig(),
      session: createSession(),
      deps: {
        buildRunLocalContext: vi.fn().mockResolvedValue({
          cwd: "/tmp/project/packages/cli",
          projectRoot: "/tmp/project",
          xpertMd: { available: false, truncated: false },
          git: {
            available: true,
            isRepo: true,
            statusShort: "M packages/cli/src/cli.ts",
            truncated: false,
          },
          workingSet: {
            recentFiles: ["packages/cli/src/cli.ts"],
            recentToolCalls: [
              {
                id: "call-1",
                toolName: "Read",
                summary: "read packages/cli/src/cli.ts",
                status: "success",
                createdAt: "2026-03-23T00:00:00.000Z",
              },
            ],
          },
        }),
      },
    });

    expect(result).toMatchObject({
      type: "history",
      item: {
        type: "status_view",
        title: "Status",
      },
    });

    if (result.type !== "history" || result.item.type !== "status_view") {
      throw new Error("Expected /status to return a status view");
    }

    expect(result.item.lines).toContain("cwd: /tmp/project/packages/cli");
    expect(result.item.lines).toContain("projectRoot: /tmp/project");
    expect(result.item.lines).toContain("approvalMode: default");
    expect(result.item.lines).toContain("git: dirty (1 changes)");
    expect(result.item.lines).toContain("  - packages/cli/src/cli.ts");
  });

  it("renders /tools from the local registry and recent tool history", async () => {
    const result = await runSlashCommand("/tools", {
      config: createConfig(),
      session: createSession({
        recentToolCalls: [
          {
            id: "call-1",
            toolName: "Patch",
            summary: "patched src/app.ts",
            status: "success",
            createdAt: "2026-03-23T00:00:00.000Z",
          },
        ],
        turns: [
          {
            turnId: "turn-1",
            prompt: "Fix app.ts",
            startedAt: "2026-03-23T00:00:00.000Z",
            finishedAt: "2026-03-23T00:00:10.000Z",
            status: "error",
            toolEvents: [
              {
                at: "2026-03-23T00:00:05.000Z",
                callId: "call-2",
                toolName: "Bash",
                argsSummary: "command=pnpm test",
                resultSummary: "exit 1",
                status: "error",
              },
            ],
            permissionEvents: [],
            changedFiles: [],
          },
        ],
      }),
      toolRegistry: createToolRegistry(),
    });

    expect(result).toMatchObject({
      type: "history",
      item: {
        type: "tools_view",
        title: "Tools",
      },
    });

    if (result.type !== "history" || result.item.type !== "tools_view") {
      throw new Error("Expected /tools to return a tools view");
    }

    expect(result.item.lines).toContain("  - Read: Read a file from the local project with line numbers.");
    expect(result.item.lines).toContain("  - Patch [success] patched src/app.ts");
    expect(result.item.lines).toContain("  - Bash [error] exit 1");
  });

  it("renders /session from session.turns", async () => {
    const result = await runSlashCommand("/session", {
      config: createConfig(),
      session: createSession({
        turns: [
          {
            turnId: "turn-1",
            prompt: "Summarize cli.ts",
            startedAt: "2026-03-23T00:00:00.000Z",
            finishedAt: "2026-03-23T00:00:10.000Z",
            status: "completed",
            assistantText: "I read cli.ts and summarized the main path.",
            toolEvents: [
              {
                at: "2026-03-23T00:00:02.000Z",
                callId: "call-1",
                toolName: "Read",
                argsSummary: "path=packages/cli/src/cli.ts",
                resultSummary: "read packages/cli/src/cli.ts",
                status: "success",
              },
            ],
            permissionEvents: [
              {
                at: "2026-03-23T00:00:01.000Z",
                toolName: "Read",
                riskLevel: "safe",
                decision: "safe_allow",
                scope: "Read packages/cli/src/cli.ts",
              },
            ],
            changedFiles: ["packages/cli/src/cli.ts"],
            threadId: "thread-1",
            runId: "run-1",
            checkpointId: "checkpoint-1",
          },
        ],
      }),
    });

    expect(result).toMatchObject({
      type: "history",
      item: {
        type: "session_view",
        title: "Session",
      },
    });

    if (result.type !== "history" || result.item.type !== "session_view") {
      throw new Error("Expected /session to return a session view");
    }

    expect(result.item.lines[0]).toContain("COMPLETED 2026-03-23T00:00:10.000Z");
    expect(result.item.lines).toContain("  prompt: Summarize cli.ts");
    expect(result.item.lines).toContain(
      "  tools: Read [success] read packages/cli/src/cli.ts",
    );
    expect(result.item.lines).toContain(
      "  permissions: Read safe_allow @ Read packages/cli/src/cli.ts",
    );
    expect(result.item.lines).toContain("  files: packages/cli/src/cli.ts");
  });

  it("keeps interactive slash commands inline when the Ink app runs in no-alt-screen mode", async () => {
    const result = await runSlashCommand("/status", {
      config: createConfig(),
      session: createSession(),
      presentation: "text",
      deps: {
        buildRunLocalContext: vi.fn().mockResolvedValue({
          cwd: "/tmp/project/packages/cli",
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

    expect(result.type).toBe("history");
    if (result.type !== "history") {
      throw new Error("Expected /status to stay inline");
    }

    expect(result.item.type).toBe("status_view");
  });

  it("returns an exit action for /exit", async () => {
    await expect(
      runSlashCommand("/exit", {
        config: createConfig(),
        session: createSession(),
      }),
    ).resolves.toEqual({ type: "exit" });
  });

  it("opens /status as an Ink inspector panel from local runtime state", async () => {
    const result = await runSlashCommand("/status", {
      config: createConfig(),
      session: createSession(),
      presentation: "ink",
      deps: {
        buildRunLocalContext: vi.fn().mockResolvedValue({
          cwd: "/tmp/project/packages/cli",
          projectRoot: "/tmp/project",
          xpertMd: { available: false, truncated: false },
          git: {
            available: true,
            isRepo: true,
            statusShort: "M packages/cli/src/cli.ts",
            truncated: false,
          },
          workingSet: {
            recentFiles: ["packages/cli/src/cli.ts"],
            recentToolCalls: [
              {
                id: "call-1",
                toolName: "Read",
                summary: "read packages/cli/src/cli.ts",
                status: "success",
                createdAt: "2026-03-23T00:00:00.000Z",
              },
            ],
          },
        }),
      },
    });

    expect(result).toMatchObject({
      type: "panel",
      panel: "status",
      data: {
        panel: "status",
        title: "Status",
      },
    });

    if (result.type !== "panel" || result.panel !== "status") {
      throw new Error("Expected /status to return a status panel");
    }

    expect(result.data.sections.flatMap((section) => section.lines)).toContain(
      "cwd: /tmp/project/packages/cli",
    );
    expect(result.data.sections.flatMap((section) => section.lines)).toContain(
      "summary: dirty (1 changes)",
    );
  });

  it("opens /tools as an Ink inspector panel from the local registry", async () => {
    const result = await runSlashCommand("/tools", {
      config: createConfig(),
      session: createSession({
        approvals: [
          {
            toolName: "Patch",
            decision: "allow",
            riskLevel: "moderate",
            scopeType: "path",
            path: "src/app.ts",
            createdAt: "2026-03-23T00:00:00.000Z",
          },
        ],
      }),
      presentation: "ink",
      toolRegistry: createToolRegistry(),
    });

    expect(result).toMatchObject({
      type: "panel",
      panel: "tools",
      data: {
        panel: "tools",
        title: "Tools",
      },
    });

    if (result.type !== "panel" || result.panel !== "tools") {
      throw new Error("Expected /tools to return a tools panel");
    }

    expect(result.data.sections.flatMap((section) => section.lines)).toContain(
      "- Read: Read a file from the local project with line numbers.",
    );
    expect(result.data.sections.flatMap((section) => section.lines)).toContain(
      "- Patch allow [moderate] src/app.ts",
    );
  });

  it("opens /session as an Ink inspector panel from local turn transcripts", async () => {
    const result = await runSlashCommand("/session", {
      config: createConfig(),
      session: createSession({
        turns: [
          {
            turnId: "turn-1",
            prompt: "Summarize cli.ts",
            startedAt: "2026-03-23T00:00:00.000Z",
            finishedAt: "2026-03-23T00:00:10.000Z",
            status: "completed",
            assistantText: "I read cli.ts and summarized the main path.",
            toolEvents: [
              {
                at: "2026-03-23T00:00:02.000Z",
                callId: "call-1",
                toolName: "Read",
                argsSummary: "path=packages/cli/src/cli.ts",
                resultSummary: "read packages/cli/src/cli.ts",
                status: "success",
              },
            ],
            permissionEvents: [
              {
                at: "2026-03-23T00:00:01.000Z",
                toolName: "Read",
                riskLevel: "safe",
                decision: "safe_allow",
                scope: "Read packages/cli/src/cli.ts",
              },
            ],
            changedFiles: ["packages/cli/src/cli.ts"],
            threadId: "thread-1",
            runId: "run-1",
            checkpointId: "checkpoint-1",
          },
        ],
      }),
      presentation: "ink",
    });

    expect(result).toMatchObject({
      type: "panel",
      panel: "session",
      data: {
        panel: "session",
        title: "Session",
      },
    });

    if (result.type !== "panel" || result.panel !== "session") {
      throw new Error("Expected /session to return a session panel");
    }

    expect(result.data.sections[0]?.title).toContain("COMPLETED 2026-03-23T00:00:10.000Z");
    expect(result.data.sections[0]?.lines).toContain("prompt: Summarize cli.ts");
    expect(result.data.sections[0]?.lines).toContain(
      "tools: Read [success] read packages/cli/src/cli.ts",
    );
    expect(result.data.sections[0]?.lines).toContain(
      "permissions: Read safe_allow @ Read packages/cli/src/cli.ts",
    );
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
  const now = "2026-03-23T00:00:00.000Z";
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
      [
        "Patch",
        {
          name: "Patch",
          description: "Patch an existing file in the local project.",
          schema: {},
          execute: vi.fn(),
        },
      ],
      [
        "Bash",
        {
          name: "Bash",
          description: "Run a shell command on the local machine.",
          schema: {},
          execute: vi.fn(),
        },
      ],
    ]),
    clientTools: [],
  };
}
