import { beforeEach, describe, expect, it, vi } from "vitest";

const createInterfaceMock = vi.fn();
const runAgentTurnMock = vi.fn();

vi.mock("node:readline/promises", () => ({
  default: {
    createInterface: createInterfaceMock,
  },
}));

vi.mock("../agent-loop.js", () => ({
  runAgentTurn: runAgentTurnMock,
}));

vi.mock("../ui/renderer.js", () => ({
  UiRenderer: class {
    printHeader() {}
    printLine() {}
  },
}));

describe("runRepl", () => {
  beforeEach(() => {
    createInterfaceMock.mockReset();
    runAgentTurnMock.mockReset();
  });

  it("creates a fresh readline interface for each prompt", async () => {
    const firstInterface = {
      question: vi.fn().mockResolvedValue("hello"),
      close: vi.fn(),
    };
    const secondInterface = {
      question: vi.fn().mockResolvedValue("/exit"),
      close: vi.fn(),
    };

    createInterfaceMock
      .mockReturnValueOnce(firstInterface)
      .mockReturnValueOnce(secondInterface);
    runAgentTurnMock.mockImplementation(async ({ session }) => session);

    const { runRepl } = await import("../repl.js");

    await runRepl({
      config: {
        apiUrl: "http://localhost:3000/api",
        apiKey: "test-key",
        assistantId: "assistant-1",
        cwd: "/tmp/project",
        projectRoot: "/tmp/project",
        approvalMode: "default",
        sandboxMode: "host",
      },
      session: {
        sessionId: "session-1",
        assistantId: "assistant-1",
        threadId: undefined,
        runId: undefined,
        checkpointId: undefined,
        cwd: "/tmp/project",
        projectRoot: "/tmp/project",
        approvals: [],
        recentFiles: [],
        recentToolCalls: [],
        updatedAt: new Date().toISOString(),
        createdAt: new Date().toISOString(),
      },
      sessionStore: {
        save: vi.fn().mockResolvedValue(undefined),
      },
    } as never);

    expect(createInterfaceMock).toHaveBeenCalledTimes(2);
    expect(firstInterface.question).toHaveBeenCalledWith("xpert> ");
    expect(firstInterface.close).toHaveBeenCalledTimes(1);
    expect(secondInterface.question).toHaveBeenCalledWith("xpert> ");
    expect(secondInterface.close).toHaveBeenCalledTimes(1);
    expect(runAgentTurnMock).toHaveBeenCalledTimes(1);
  });
});
