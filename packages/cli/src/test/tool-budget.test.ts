import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MAX_TOOL_CALLS_PER_TURN } from "../runtime/tool-budget.js";

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

vi.mock("../ui/renderer.js", () => ({
  UiRenderer: class {
    readonly interactive: boolean;

    constructor(options?: { interactive?: boolean }) {
      this.interactive = options?.interactive ?? false;
    }

    writeText() {}
    printReasoning() {}
    printLine() {}
    printToolCall() {}
    printWarning() {}
    printToolAck() {}
    printError() {}
  },
}));

describe("tool call budget", () => {
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
    ensureThreadMock.mockResolvedValue("thread-1");
    streamPromptMock.mockImplementation(async (input: { onRunCreated?: (value: { runId?: string; threadId?: string }) => void }) => {
      input.onRunCreated?.({ runId: "run-1", threadId: "thread-1" });
      return { stream: [] };
    });
    resumeWithToolMessagesMock.mockImplementation(async (input: { onRunCreated?: (value: { runId?: string; threadId?: string }) => void }) => {
      input.onRunCreated?.({ runId: "run-1", threadId: "thread-1" });
      return { stream: [] };
    });
    getCheckpointMock.mockResolvedValue("checkpoint-1");
    permissionRequestMock.mockResolvedValue({
      allowed: true,
      riskLevel: "safe",
      scope: "Read",
      outcome: "safe_allow",
    });
    toolExecuteMock.mockImplementation(async (args: { path: string }) => ({
      summary: `read ${args.path}`,
      content: `content for ${args.path}`,
    }));
  });

  it("returns a clear budget error and stops executing later tool calls", async () => {
    const { runAgentTurn } = await import("../agent-loop.js");

    streamBatches = [
      [
        ...Array.from({ length: MAX_TOOL_CALLS_PER_TURN + 1 }, (_, index) => ({
          type: "tool_call" as const,
          toolName: "Read",
          callId: `call-${index + 1}`,
          args: { path: `file-${index + 1}.txt` },
        })),
        { type: "done" as const, threadId: "thread-1", runId: "run-1" },
      ],
      [{ type: "done" as const, threadId: "thread-1", runId: "run-1" }],
    ];

    const session = createSession();
    const nextSession = await runAgentTurn({
      prompt: "Inspect the workspace.",
      config: createConfig(),
      session,
      interactive: false,
    });

    expect(toolExecuteMock).toHaveBeenCalledTimes(MAX_TOOL_CALLS_PER_TURN);
    expect(resumeWithToolMessagesMock).toHaveBeenCalledTimes(1);

    const toolMessages = resumeWithToolMessagesMock.mock.calls[0]?.[0]?.toolMessages;
    expect(toolMessages).toHaveLength(MAX_TOOL_CALLS_PER_TURN + 1);
    expect(toolMessages.at(-1)).toMatchObject({
      tool_call_id: `call-${MAX_TOOL_CALLS_PER_TURN + 1}`,
      name: "Read",
      status: "error",
    });
    expect(String(toolMessages.at(-1)?.content)).toContain("TOOL_CALL_BUDGET_EXCEEDED");

    expect(nextSession.turns).toHaveLength(1);
    expect(nextSession.turns[0]?.toolEvents.at(-1)).toMatchObject({
      callId: `call-${MAX_TOOL_CALLS_PER_TURN + 1}`,
      status: "error",
      code: "TOOL_CALL_BUDGET_EXCEEDED",
    });
  });
});

function createConfig() {
  return {
    apiUrl: "http://localhost:3000/api",
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

function createSession() {
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
