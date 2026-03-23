import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { formatCliError, XpertCliRequestError } from "../sdk/request-errors.js";
import type { CliSessionState } from "../runtime/session-store.js";

const buildRunLocalContextMock = vi.fn();
const ensureThreadMock = vi.fn();
const streamPromptMock = vi.fn();
const resumeWithToolMessagesMock = vi.fn();
const getCheckpointMock = vi.fn();
const toolExecuteMock = vi.fn();
const permissionRequestMock = vi.fn();
let streamBatches: Array<any[]> = [];

vi.mock("../context/run-context.js", () => ({
  buildRunLocalContext: buildRunLocalContextMock,
}));

vi.mock("../sdk/client.js", () => ({
  XpertSdkClient: class {
    ensureThread = ensureThreadMock;
    streamPrompt = streamPromptMock;
    resumeWithToolMessages = resumeWithToolMessagesMock;
    getCheckpoint = getCheckpointMock;
  },
}));

vi.mock("../sdk/run-stream.js", () => ({
  adaptRunStream: async function* () {
    const events = streamBatches.shift() ?? [];
    for (const event of events) {
      yield event;
    }
  },
}));

vi.mock("../permissions/manager.js", () => ({
  PermissionManager: class {
    request = permissionRequestMock;
  },
}));

vi.mock("../tools/registry.js", () => ({
  createToolRegistry: () => ({
    tools: new Map([
      [
        "Read",
        {
          name: "Read",
          description: "Read",
          schema: {},
          execute: toolExecuteMock,
        },
      ],
    ]),
    clientTools: [],
  }),
}));

vi.mock("../tools/backends/host.js", () => ({
  HostExecutionBackend: class {
    constructor() {}
  },
  resolveWorkspacePath: (projectRoot: string, inputPath: string) =>
    path.resolve(projectRoot, inputPath),
}));

describe("agent loop request error handling", () => {
  beforeEach(() => {
    buildRunLocalContextMock.mockReset();
    ensureThreadMock.mockReset();
    streamPromptMock.mockReset();
    resumeWithToolMessagesMock.mockReset();
    getCheckpointMock.mockReset();
    toolExecuteMock.mockReset();
    permissionRequestMock.mockReset();
    streamBatches = [];

    buildRunLocalContextMock.mockResolvedValue({
      cwd: "/tmp/project",
      projectRoot: "/tmp/project",
      workingSet: {
        recentFiles: [],
        recentToolCalls: [],
      },
    });
    ensureThreadMock.mockImplementation(
      async (existingThreadId?: string) => existingThreadId ?? "thread-1",
    );
    streamPromptMock.mockImplementation(
      async (input: { onRunCreated?: (value: { runId?: string; threadId?: string }) => void }) => {
        input.onRunCreated?.({ runId: "run-1", threadId: "thread-1" });
        return {
          requestUrl: "http://localhost:3000/api/ai/threads/thread-1/runs/stream",
          stream: [],
        };
      },
    );
    resumeWithToolMessagesMock.mockImplementation(
      async (input: { onRunCreated?: (value: { runId?: string; threadId?: string }) => void }) => {
        input.onRunCreated?.({ runId: "run-1", threadId: "thread-1" });
        return {
          requestUrl: "http://localhost:3000/api/ai/threads/thread-1/runs/stream",
          stream: [],
        };
      },
    );
    getCheckpointMock.mockResolvedValue("checkpoint-1");
    permissionRequestMock.mockResolvedValue({
      allowed: true,
      riskLevel: "safe",
      scope: "Read",
      outcome: "safe_allow",
    });
    toolExecuteMock.mockResolvedValue({
      summary: "read README.md",
      content: "README",
    });
  });

  it("treats a stream that ends without done and without tool calls as interrupted", async () => {
    const { runAgentTurn } = await import("../agent-loop.js");

    streamBatches = [[{ type: "text_delta" as const, text: "partial" }]];

    await expect(
      runAgentTurn({
        prompt: "Inspect the repo.",
        config: createConfig(),
        session: createSession(),
        interactive: false,
      }),
    ).rejects.toSatisfy((error: unknown) => {
      expect(error).toBeInstanceOf(XpertCliRequestError);
      expect((error as XpertCliRequestError).kind).toBe("stream_interrupted");
      expect(formatCliError(error)).toContain(
        "error: run stream was interrupted before the turn completed",
      );
      return true;
    });

    expect(getCheckpointMock).not.toHaveBeenCalled();
  });

  it("still resumes tool calls when an interrupt stream ends without done", async () => {
    const { runAgentTurn } = await import("../agent-loop.js");

    streamBatches = [
      [
        {
          type: "tool_call" as const,
          toolName: "Read",
          callId: "call-1",
          args: { path: "README.md" },
        },
      ],
      [{ type: "done" as const, threadId: "thread-1", runId: "run-1" }],
    ];

    const nextSession = await runAgentTurn({
      prompt: "Read README.md",
      config: createConfig(),
      session: createSession(),
      interactive: false,
    });

    expect(resumeWithToolMessagesMock).toHaveBeenCalledTimes(1);
    expect(nextSession.runId).toBe("run-1");
    expect(nextSession.checkpointId).toBe("checkpoint-1");
  });

  it("retries the first prompt once when the saved remote thread is missing", async () => {
    const { runAgentTurn } = await import("../agent-loop.js");

    streamPromptMock.mockReset();
    streamPromptMock
      .mockImplementationOnce(
        async (input: { threadId?: string; onRunCreated?: (value: { runId?: string; threadId?: string }) => void }) => {
          input.onRunCreated?.({ runId: "run-stale", threadId: input.threadId });
          return {
            requestUrl: "http://localhost:3000/api/ai/threads/thread-stale/runs/stream",
            stream: [],
          };
        },
      )
      .mockImplementationOnce(
        async (input: { threadId?: string; onRunCreated?: (value: { runId?: string; threadId?: string }) => void }) => {
          input.onRunCreated?.({ runId: "run-fresh", threadId: "thread-fresh" });
          return {
            requestUrl: "http://localhost:3000/api/ai/threads/thread-fresh/runs/stream",
            stream: [],
          };
        },
      );

    streamBatches = [
      [{ type: "error" as const, message: "The requested record was not found" }],
      [
        { type: "text_delta" as const, text: "Recovered on a fresh thread." },
        { type: "done" as const, threadId: "thread-fresh", runId: "run-fresh" },
      ],
    ];

    const session = createSession();
    session.threadId = "thread-stale";
    session.runId = "run-stale";
    session.checkpointId = "checkpoint-stale";

    const nextSession = await runAgentTurn({
      prompt: "hi",
      config: createConfig(),
      session,
      interactive: false,
    });

    expect(streamPromptMock).toHaveBeenCalledTimes(2);
    expect(streamPromptMock.mock.calls[0]?.[0]?.threadId).toBe("thread-stale");
    expect(streamPromptMock.mock.calls[1]?.[0]?.threadId).toBeUndefined();
    expect(nextSession.threadId).toBe("thread-fresh");
    expect(nextSession.runId).toBe("run-fresh");
    expect(nextSession.checkpointId).toBe("checkpoint-1");
  });

  it("preserves explicit backend stream errors on the first run", async () => {
    const { runAgentTurn } = await import("../agent-loop.js");

    streamBatches = [[{ type: "error" as const, message: "assistant not found" }]];

    await expect(
      runAgentTurn({
        prompt: "Inspect the repo.",
        config: createConfig(),
        session: createSession(),
        interactive: false,
      }),
    ).rejects.toSatisfy((error: unknown) => {
      expect(error).toBeInstanceOf(XpertCliRequestError);
      expect(formatCliError(error)).toContain("error: assistant not found");
      expect(formatCliError(error)).not.toContain("run stream was interrupted");
      return true;
    });
  });

  it("preserves explicit backend stream errors on resume", async () => {
    const { runAgentTurn } = await import("../agent-loop.js");

    streamBatches = [
      [
        {
          type: "tool_call" as const,
          toolName: "Read",
          callId: "call-1",
          args: { path: "README.md" },
        },
      ],
      [{ type: "error" as const, message: "resume payload invalid" }],
    ];

    await expect(
      runAgentTurn({
        prompt: "Read README.md",
        config: createConfig(),
        session: createSession(),
        interactive: false,
      }),
    ).rejects.toSatisfy((error: unknown) => {
      expect(error).toBeInstanceOf(XpertCliRequestError);
      expect((error as XpertCliRequestError).kind).toBe("resume_failed");
      expect(formatCliError(error)).toContain("error: resume payload invalid");
      expect(formatCliError(error)).not.toContain(
        "tool results could not be resumed to the current run",
      );
      return true;
    });
  });
});

function createConfig() {
  return {
    apiUrl: "http://localhost:3000/api/ai",
    apiKey: "test-key",
    assistantId: "assistant-1",
    cwd: "/tmp/project",
    projectRoot: "/tmp/project",
    userConfigDir: "/tmp/.xpert-cli",
    userConfigPath: "/tmp/.xpert-cli/config.json",
    projectConfigPath: "/tmp/project/.xpert-cli.json",
    approvalMode: "default" as const,
    sandboxMode: "host" as const,
  };
}

function createSession(): CliSessionState {
  const now = new Date().toISOString();
  return {
    sessionId: "session-1",
    assistantId: "assistant-1",
    cwd: "/tmp/project",
    projectRoot: "/tmp/project",
    recentFiles: [],
    recentToolCalls: [],
    approvals: [],
    turns: [],
    createdAt: now,
    updatedAt: now,
  };
}
