import { beforeEach, describe, expect, it, vi } from "vitest";

const loadResolvedConfigMock = vi.fn();
const resolveProjectRootMock = vi.fn();
const resolveCwdMock = vi.fn();
const runCliPreflightMock = vi.fn();
const assertCliPreflightMock = vi.fn();
const resolveCliExecutionModeMock = vi.fn();
const runInteractiveAppMock = vi.fn();
const sessionStoreLoadMock = vi.fn();
const sessionStoreResolveLatestMock = vi.fn();
const sessionStoreCreateMock = vi.fn();
const sessionStoreSaveMock = vi.fn();

vi.mock("../context/config-loader.js", () => ({
  loadResolvedConfig: loadResolvedConfigMock,
}));

vi.mock("../runtime/project-root.js", () => ({
  resolveProjectRoot: resolveProjectRootMock,
  resolveCwd: resolveCwdMock,
}));

vi.mock("../runtime/preflight.js", () => ({
  runCliPreflight: runCliPreflightMock,
  assertCliPreflight: assertCliPreflightMock,
  renderDoctorReport: vi.fn(),
}));

vi.mock("../ui/mode.js", () => ({
  resolveCliExecutionMode: resolveCliExecutionModeMock,
}));

vi.mock("../ui/renderer.js", () => ({
  UiRenderer: class {
    printWarning() {}
    printLine() {}
    printJson() {}
  },
}));

vi.mock("../interactive.js", () => ({
  runInteractiveApp: runInteractiveAppMock,
}));

vi.mock("../runtime/session-store.js", () => ({
  SessionStore: class {
    constructor() {}

    load = sessionStoreLoadMock;
    resolveLatestForProjectRoot = sessionStoreResolveLatestMock;
    create = sessionStoreCreateMock;
    save = sessionStoreSaveMock;
  },
}));

describe("runCli resume", () => {
  beforeEach(() => {
    vi.resetModules();
    loadResolvedConfigMock.mockReset();
    resolveProjectRootMock.mockReset();
    resolveCwdMock.mockReset();
    runCliPreflightMock.mockReset();
    assertCliPreflightMock.mockReset();
    resolveCliExecutionModeMock.mockReset();
    runInteractiveAppMock.mockReset();
    sessionStoreLoadMock.mockReset();
    sessionStoreResolveLatestMock.mockReset();
    sessionStoreCreateMock.mockReset();
    sessionStoreSaveMock.mockReset();

    resolveProjectRootMock.mockReturnValue("/tmp/project");
    resolveCwdMock.mockReturnValue("/tmp/project");
    loadResolvedConfigMock.mockResolvedValue(createConfig());
    runCliPreflightMock.mockResolvedValue({ ok: true });
    resolveCliExecutionModeMock.mockReturnValue("interactive_ink");
    sessionStoreSaveMock.mockResolvedValue(undefined);
    sessionStoreResolveLatestMock.mockResolvedValue(null);
    sessionStoreCreateMock.mockResolvedValue(createSession());
    runInteractiveAppMock.mockResolvedValue(undefined);
  });

  it("routes resume into the shared interactive startup path with persisted render items intact", async () => {
    const resumedSession = createSession();
    sessionStoreLoadMock.mockResolvedValue(resumedSession);

    const { runCli } = await import("../cli.js");

    await runCli(["resume", "session-1"]);

    expect(sessionStoreLoadMock).toHaveBeenCalledWith("session-1");
    expect(runInteractiveAppMock).toHaveBeenCalledTimes(1);
    expect(runInteractiveAppMock.mock.calls[0]?.[0]).toMatchObject({
      session: {
        sessionId: "session-1",
        turns: [
          {
            renderItems: [
              {
                type: "user_prompt",
                text: "Read README.md",
              },
              {
                type: "assistant_text",
                text: "Opening README.md",
              },
            ],
          },
        ],
      },
    });
  });
});

function createConfig() {
  return {
    apiUrl: "http://localhost:3000/api/ai",
    apiKey: "test-key",
    assistantId: "assistant-1",
    defaultModel: "gpt-5.4",
    organizationId: undefined,
    approvalMode: "default" as const,
    sandboxMode: "host" as const,
    projectRoot: "/tmp/project",
    cwd: "/tmp/project",
    userConfigDir: "/tmp/.xpert-cli",
    userConfigPath: "/tmp/.xpert-cli/config.json",
    projectConfigPath: "/tmp/project/.xpert-cli.json",
    xpertMdPath: undefined,
    xpertMdContent: undefined,
  };
}

function createSession() {
  const now = "2026-03-25T00:00:00.000Z";
  return {
    sessionId: "session-1",
    assistantId: "assistant-1",
    cwd: "/tmp/project",
    projectRoot: "/tmp/project",
    recentFiles: [],
    recentToolCalls: [],
    approvals: [],
    turns: [
      {
        turnId: "turn-1",
        prompt: "Read README.md",
        startedAt: "2026-03-25T00:00:01.000Z",
        finishedAt: "2026-03-25T00:00:02.000Z",
        status: "completed" as const,
        toolEvents: [],
        permissionEvents: [],
        changedFiles: [],
        renderItems: [
          {
            type: "user_prompt" as const,
            text: "Read README.md",
          },
          {
            type: "assistant_text" as const,
            text: "Opening README.md",
          },
        ],
      },
    ],
    createdAt: now,
    updatedAt: now,
  };
}
