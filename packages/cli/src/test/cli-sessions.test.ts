import { beforeEach, describe, expect, it, vi } from "vitest";

const loadResolvedConfigMock = vi.fn();
const resolveProjectRootMock = vi.fn();
const resolveCwdMock = vi.fn();
const sessionStoreListMock = vi.fn();
const sessionStoreDeleteMock = vi.fn();
const sessionStorePruneMock = vi.fn();
const sessionStoreResolveLatestMock = vi.fn();
const sessionStoreCreateMock = vi.fn();
const sessionStoreSaveMock = vi.fn();
const printLineMock = vi.fn();
const printJsonMock = vi.fn();
const printSuccessMock = vi.fn();
const printWarningMock = vi.fn();

vi.mock("../context/config-loader.js", () => ({
  loadResolvedConfig: loadResolvedConfigMock,
}));

vi.mock("../runtime/project-root.js", () => ({
  resolveProjectRoot: resolveProjectRootMock,
  resolveCwd: resolveCwdMock,
}));

vi.mock("../ui/renderer.js", () => ({
  UiRenderer: class {
    printLine = printLineMock;
    printJson = printJsonMock;
    printSuccess = printSuccessMock;
    printWarning = printWarningMock;
  },
}));

vi.mock("../runtime/session-store.js", () => ({
  SessionStore: class {
    constructor() {}

    list = sessionStoreListMock;
    delete = sessionStoreDeleteMock;
    prune = sessionStorePruneMock;
    resolveLatestForProjectRoot = sessionStoreResolveLatestMock;
    create = sessionStoreCreateMock;
    save = sessionStoreSaveMock;
  },
}));

describe("runCli sessions", () => {
  beforeEach(() => {
    vi.resetModules();
    loadResolvedConfigMock.mockReset();
    resolveProjectRootMock.mockReset();
    resolveCwdMock.mockReset();
    sessionStoreListMock.mockReset();
    sessionStoreDeleteMock.mockReset();
    sessionStorePruneMock.mockReset();
    sessionStoreResolveLatestMock.mockReset();
    sessionStoreCreateMock.mockReset();
    sessionStoreSaveMock.mockReset();
    printLineMock.mockReset();
    printJsonMock.mockReset();
    printSuccessMock.mockReset();
    printWarningMock.mockReset();

    resolveProjectRootMock.mockReturnValue("/tmp/project");
    resolveCwdMock.mockReturnValue("/tmp/project");
    loadResolvedConfigMock.mockResolvedValue(createConfig());
  });

  it("treats `xpert sessions` as `xpert sessions list`", async () => {
    sessionStoreListMock.mockResolvedValue([
      createSession({
        sessionId: "28dfbacc-1111-2222-3333-444444444444",
        turns: [
          createTurn({
            prompt: "Read README and explain CLI flow",
            status: "completed",
          }),
        ],
      }),
    ]);

    const { runCli } = await import("../cli.js");

    await runCli(["sessions"]);

    expect(sessionStoreListMock).toHaveBeenCalledWith({
      projectRoot: "/tmp/project",
    });
    expect(printLineMock.mock.calls[0]?.[0]).toContain(
      "Local sessions for /tmp/project",
    );
    expect(printLineMock.mock.calls[0]?.[0]).toContain("28dfbacc");
    expect(printLineMock.mock.calls[0]?.[0]).toContain("Read README and explain CLI flow");
  });

  it("prints machine-readable JSON for `sessions list --json`", async () => {
    sessionStoreListMock.mockResolvedValue([
      createSession({
        sessionId: "9a71c3d2-1111-2222-3333-444444444444",
        turns: [createTurn({ prompt: "Fix request error handling" })],
      }),
    ]);

    const { runCli } = await import("../cli.js");

    await runCli(["sessions", "list", "--json"]);

    expect(printJsonMock).toHaveBeenCalledWith({
      scope: "project",
      projectRoot: "/tmp/project",
      count: 1,
      totalCount: 1,
      limit: 10,
      sessions: [
        expect.objectContaining({
          sessionId: "9a71c3d2-1111-2222-3333-444444444444",
          shortId: "9a71c3d2",
          title: "Fix request error handling",
          lastTurnStatus: "completed",
        }),
      ],
    });
  });

  it("deletes a selected session by unique prefix", async () => {
    sessionStoreListMock.mockResolvedValue([
      createSession({
        sessionId: "28dfbacc-1111-2222-3333-444444444444",
        turns: [createTurn({ prompt: "Read README and explain CLI flow" })],
      }),
    ]);
    sessionStoreDeleteMock.mockResolvedValue(true);

    const { runCli } = await import("../cli.js");

    await runCli(["sessions", "delete", "28dfbacc"]);

    expect(sessionStoreDeleteMock).toHaveBeenCalledWith(
      "28dfbacc-1111-2222-3333-444444444444",
    );
    expect(printSuccessMock).toHaveBeenCalledWith(
      "deleted local session 28dfbacc Read README and explain CLI flow",
    );
  });

  it("prunes older sessions when `--yes` is provided", async () => {
    sessionStoreListMock.mockResolvedValue([
      createSession({ sessionId: "keep-1-1111-2222-3333-444444444444" }),
      createSession({ sessionId: "keep-2-1111-2222-3333-444444444444" }),
      createSession({ sessionId: "keep-3-1111-2222-3333-444444444444" }),
      createSession({ sessionId: "delete-4-1111-2222-3333-444444444444" }),
    ]);
    sessionStorePruneMock.mockResolvedValue({
      kept: [
        createSession({ sessionId: "keep-1-1111-2222-3333-444444444444" }),
        createSession({ sessionId: "keep-2-1111-2222-3333-444444444444" }),
        createSession({ sessionId: "keep-3-1111-2222-3333-444444444444" }),
      ],
      deleted: [
        createSession({ sessionId: "delete-4-1111-2222-3333-444444444444" }),
      ],
    });

    const { runCli } = await import("../cli.js");

    await runCli(["sessions", "prune", "--keep", "3", "--yes"]);

    expect(sessionStorePruneMock).toHaveBeenCalledWith({
      keep: 3,
      projectRoot: "/tmp/project",
    });
    expect(printSuccessMock).toHaveBeenCalledWith(
      "pruned 1 local session; kept 3",
    );
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

function createSession(overrides: Record<string, unknown> = {}) {
  const now = "2026-03-25T00:00:00.000Z";
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
    ...overrides,
  };
}

function createTurn(overrides: Record<string, unknown> = {}) {
  return {
    turnId: "turn-1",
    prompt: "Read README.md",
    startedAt: "2026-03-25T00:00:01.000Z",
    finishedAt: "2026-03-25T00:00:02.000Z",
    status: "completed" as const,
    toolEvents: [],
    permissionEvents: [],
    changedFiles: [],
    ...overrides,
  };
}
