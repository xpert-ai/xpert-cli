import { beforeEach, describe, expect, it, vi } from "vitest";

const loadResolvedConfigMock = vi.fn();
const resolveProjectRootMock = vi.fn();
const resolveCwdMock = vi.fn();
const runCliPreflightMock = vi.fn();
const assertCliPreflightMock = vi.fn();
const resolveCliExecutionModeMock = vi.fn();
const runInteractiveAppMock = vi.fn();
const sessionStoreLoadMock = vi.fn();
const sessionStoreListMock = vi.fn();
const sessionStoreResolveLatestMock = vi.fn();
const sessionStoreCreateMock = vi.fn();
const sessionStoreSaveMock = vi.fn();
const printWarningMock = vi.fn();
const printLineMock = vi.fn();
const printJsonMock = vi.fn();

vi.mock("../context/config-loader.js", () => ({
  loadResolvedConfig: loadResolvedConfigMock,
}));

vi.mock("../runtime/project-root.js", () => ({
  resolveProjectRoot: resolveProjectRootMock,
  resolveCwd: resolveCwdMock,
  isWithinRoot: (projectRoot: string, targetPath: string) =>
    targetPath === projectRoot || targetPath.startsWith(`${projectRoot}/`),
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
    printWarning = printWarningMock;
    printLine = printLineMock;
    printJson = printJsonMock;
  },
}));

vi.mock("../interactive.js", () => ({
  runInteractiveApp: runInteractiveAppMock,
}));

vi.mock("../runtime/session-store.js", () => ({
  SessionStore: class {
    constructor() {}

    load = sessionStoreLoadMock;
    list = sessionStoreListMock;
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
    sessionStoreListMock.mockReset();
    sessionStoreResolveLatestMock.mockReset();
    sessionStoreCreateMock.mockReset();
    sessionStoreSaveMock.mockReset();
    printWarningMock.mockReset();
    printLineMock.mockReset();
    printJsonMock.mockReset();

    resolveProjectRootMock.mockImplementation((options?: { cwd?: string }) =>
      options?.cwd ? `/tmp/current-project/${options.cwd}` : "/tmp/current-project",
    );
    resolveCwdMock.mockImplementation((projectRoot: string, requestedCwd?: string) =>
      requestedCwd ? `/tmp/current-project/${requestedCwd}` : projectRoot,
    );
    loadResolvedConfigMock.mockImplementation(
      async ({ projectRoot, cwd }: { projectRoot: string; cwd: string }) =>
        createConfig({ projectRoot, cwd }),
    );
    runCliPreflightMock.mockResolvedValue({ ok: true });
    resolveCliExecutionModeMock.mockReturnValue("interactive_ink");
    sessionStoreSaveMock.mockResolvedValue(undefined);
    sessionStoreLoadMock.mockResolvedValue(null);
    sessionStoreResolveLatestMock.mockResolvedValue(null);
    sessionStoreCreateMock.mockResolvedValue(createSession());
    runInteractiveAppMock.mockResolvedValue(undefined);
  });

  it("routes resume unique prefixes through project-scoped selector resolution with persisted render items intact", async () => {
    const resumedSession = createSession();
    sessionStoreListMock.mockResolvedValue([resumedSession]);

    const { runCli } = await import("../cli.js");

    await runCli(["resume", "session-"]);

    expect(sessionStoreListMock).toHaveBeenCalledWith({
      projectRoot: "/tmp/current-project",
    });
    expect(loadResolvedConfigMock).toHaveBeenCalledWith({
      projectRoot: "/tmp/current-project",
      cwd: "/tmp/current-project",
    });
    expect(runInteractiveAppMock).toHaveBeenCalledTimes(1);
    expect(runInteractiveAppMock.mock.calls[0]?.[0]).toMatchObject({
      config: {
        projectRoot: "/tmp/current-project",
        cwd: "/tmp/current-project",
      },
      session: {
        sessionId: "session-1",
        projectRoot: "/tmp/current-project",
        cwd: "/tmp/current-project",
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

  it("resumes a full session id into the saved project context and uses that config for reset/preflight", async () => {
    const resumedSession = createSession({
      sessionId: "session-2",
      projectRoot: "/tmp/other-project",
      cwd: "/tmp/other-project/packages/api",
      remoteFingerprint: {
        apiUrl: "http://localhost:3000/api/ai",
        assistantId: "assistant-1",
      },
      threadId: "thread-1",
      runId: "run-1",
      checkpointId: "checkpoint-1",
    });
    sessionStoreLoadMock.mockResolvedValue(resumedSession);
    loadResolvedConfigMock.mockImplementation(
      async ({ projectRoot, cwd }: { projectRoot: string; cwd: string }) =>
        createConfig({
          projectRoot,
          cwd,
          apiUrl:
            projectRoot === "/tmp/other-project"
              ? "http://localhost:4000/api/ai"
              : "http://localhost:3000/api/ai",
        }),
    );

    const { runCli } = await import("../cli.js");

    await runCli(["resume", "session-2"]);

    expect(sessionStoreLoadMock).toHaveBeenCalledWith("session-2");
    expect(sessionStoreListMock).not.toHaveBeenCalled();
    expect(loadResolvedConfigMock).toHaveBeenCalledWith({
      projectRoot: "/tmp/other-project",
      cwd: "/tmp/other-project/packages/api",
    });
    expect(runCliPreflightMock).toHaveBeenCalledWith(
      expect.objectContaining({
        projectRoot: "/tmp/other-project",
        cwd: "/tmp/other-project/packages/api",
        apiUrl: "http://localhost:4000/api/ai",
      }),
      { mode: "light" },
    );
    expect(sessionStoreSaveMock).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: "session-2",
        projectRoot: "/tmp/other-project",
        cwd: "/tmp/other-project/packages/api",
        threadId: undefined,
        runId: undefined,
        checkpointId: undefined,
      }),
    );
    expect(runInteractiveAppMock).toHaveBeenCalledTimes(1);
    expect(runInteractiveAppMock.mock.calls[0]?.[0]).toMatchObject({
      config: {
        projectRoot: "/tmp/other-project",
        cwd: "/tmp/other-project/packages/api",
      },
      session: {
        sessionId: "session-2",
        projectRoot: "/tmp/other-project",
        cwd: "/tmp/other-project/packages/api",
        threadId: undefined,
        runId: undefined,
        checkpointId: undefined,
      },
    });
    expect(printWarningMock).toHaveBeenCalledWith(
      expect.stringContaining("resumed local session from /tmp/other-project"),
    );
  });

  it("keeps exact full-id --cwd overrides inside the resumed project root", async () => {
    const resumedSession = createSession({
      sessionId: "session-2",
      projectRoot: "/tmp/other-project",
      cwd: "/tmp/other-project",
    });
    sessionStoreLoadMock.mockResolvedValue(resumedSession);

    const { runCli } = await import("../cli.js");

    await runCli(["resume", "session-2", "--cwd", "packages/api"]);

    expect(loadResolvedConfigMock).toHaveBeenCalledWith({
      projectRoot: "/tmp/other-project",
      cwd: "/tmp/other-project/packages/api",
    });
    expect(runInteractiveAppMock.mock.calls[0]?.[0]).toMatchObject({
      config: {
        projectRoot: "/tmp/other-project",
        cwd: "/tmp/other-project/packages/api",
      },
      session: {
        projectRoot: "/tmp/other-project",
        cwd: "/tmp/other-project/packages/api",
      },
    });
  });

  it("falls back to the resumed project root when an exact full-id session saved cwd escapes that project", async () => {
    const resumedSession = createSession({
      sessionId: "session-2",
      projectRoot: "/tmp/other-project",
      cwd: "/tmp/outside-project",
    });
    sessionStoreLoadMock.mockResolvedValue(resumedSession);

    const { runCli } = await import("../cli.js");

    await runCli(["resume", "session-2"]);

    expect(loadResolvedConfigMock).toHaveBeenCalledWith({
      projectRoot: "/tmp/other-project",
      cwd: "/tmp/other-project",
    });
    expect(runInteractiveAppMock.mock.calls[0]?.[0]).toMatchObject({
      config: {
        projectRoot: "/tmp/other-project",
        cwd: "/tmp/other-project",
      },
      session: {
        projectRoot: "/tmp/other-project",
        cwd: "/tmp/other-project",
      },
    });
  });

  it("rejects exact full-id --cwd overrides that escape the resumed project root", async () => {
    const resumedSession = createSession({
      sessionId: "session-2",
      projectRoot: "/tmp/other-project",
      cwd: "/tmp/other-project",
    });
    sessionStoreLoadMock.mockResolvedValue(resumedSession);

    const { runCli } = await import("../cli.js");

    await expect(runCli(["resume", "session-2", "--cwd", "../outside"])).rejects.toThrow(
      /This resume target belongs to another project: \/tmp\/other-project\.\n--cwd must stay within that project\./,
    );
    expect(loadResolvedConfigMock).not.toHaveBeenCalled();
    expect(runCliPreflightMock).not.toHaveBeenCalled();
    expect(sessionStoreSaveMock).not.toHaveBeenCalled();
  });

  it("keeps bare `resume` scoped to the latest local session for the current project", async () => {
    sessionStoreResolveLatestMock.mockResolvedValue(
      createSession({
        sessionId: "session-current",
        projectRoot: "/tmp/current-project",
        cwd: "/tmp/current-project",
      }),
    );

    const { runCli } = await import("../cli.js");

    await runCli(["resume"]);

    expect(sessionStoreResolveLatestMock).toHaveBeenCalledWith("/tmp/current-project");
    expect(sessionStoreLoadMock).not.toHaveBeenCalled();
    expect(sessionStoreListMock).not.toHaveBeenCalled();
    expect(runInteractiveAppMock.mock.calls[0]?.[0]).toMatchObject({
      config: {
        projectRoot: "/tmp/current-project",
        cwd: "/tmp/current-project",
      },
      session: {
        sessionId: "session-current",
        projectRoot: "/tmp/current-project",
        cwd: "/tmp/current-project",
      },
    });
  });
});

function createConfig(overrides: Record<string, unknown> = {}) {
  return {
    apiUrl: "http://localhost:3000/api/ai",
    apiKey: "test-key",
    assistantId: "assistant-1",
    defaultModel: "gpt-5.4",
    organizationId: undefined,
    approvalMode: "default" as const,
    sandboxMode: "host" as const,
    projectRoot: "/tmp/current-project",
    cwd: "/tmp/current-project",
    userConfigDir: "/tmp/.xpert-cli",
    userConfigPath: "/tmp/.xpert-cli/config.json",
    projectConfigPath: "/tmp/current-project/.xpert-cli.json",
    xpertMdPath: undefined,
    xpertMdContent: undefined,
    ...overrides,
  };
}

function createSession(overrides: Record<string, unknown> = {}) {
  const now = "2026-03-25T00:00:00.000Z";
  return {
    sessionId: "session-1",
    assistantId: "assistant-1",
    cwd: "/tmp/current-project",
    projectRoot: "/tmp/current-project",
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
    ...overrides,
  };
}
