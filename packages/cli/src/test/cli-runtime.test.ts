import { describe, expect, it, vi } from "vitest";
import { prepareSessionRuntime } from "../cli.js";
import type { CliSessionState } from "../runtime/session-store.js";

describe("prepareSessionRuntime", () => {
  it("clears stale remote ids when the remote fingerprint mismatches at startup", async () => {
    const session = createSession();
    session.remoteFingerprint = {
      apiUrl: "http://localhost:3000/api/ai",
      organizationId: "org-1",
      assistantId: "assistant-old",
    };
    session.threadId = "thread-1";
    session.runId = "run-1";
    session.checkpointId = "checkpoint-1";

    const result = await prepareSessionRuntime({
      config: createConfig(),
      sessionStore: {
        load: vi.fn(),
        resolveLatestForProjectRoot: vi.fn().mockResolvedValue(session),
        create: vi.fn(),
      },
    } as never);

    expect(result.session.threadId).toBeUndefined();
    expect(result.session.runId).toBeUndefined();
    expect(result.session.checkpointId).toBeUndefined();
    expect(result.session.recentFiles).toEqual(["README.md"]);
    expect(result.startupNotice).toBe(
      "remote config changed; stale remote run state cleared",
    );
  });

  it("does not rebind a cross-project exact session onto the caller runtime paths by default", async () => {
    const session = createSession({
      projectRoot: "/tmp/other-project",
      cwd: "/tmp/other-project/packages/api",
    });

    const result = await prepareSessionRuntime(
      {
        config: createConfig(),
        sessionStore: {
          load: vi.fn().mockResolvedValue(session),
          resolveLatestForProjectRoot: vi.fn(),
          create: vi.fn(),
        },
      } as never,
      {
        sessionSelector: "session-1",
      },
    );

    expect(result.session.projectRoot).toBe("/tmp/other-project");
    expect(result.session.cwd).toBe("/tmp/other-project/packages/api");
  });
});

function createConfig(overrides: Record<string, unknown> = {}) {
  return {
    apiUrl: "http://localhost:3000/api/ai",
    apiKey: "test-key",
    assistantId: "assistant-new",
    defaultModel: undefined,
    organizationId: "org-1",
    approvalMode: "default" as const,
    sandboxMode: "host" as const,
    projectRoot: "/tmp/project",
    cwd: "/tmp/project",
    userConfigDir: "/tmp/.xpert-cli",
    userConfigPath: "/tmp/.xpert-cli/config.json",
    projectConfigPath: "/tmp/project/.xpert-cli.json",
    xpertMdPath: undefined,
    xpertMdContent: undefined,
    ...overrides,
  };
}

function createSession(overrides: Record<string, unknown> = {}): CliSessionState {
  const now = new Date().toISOString();
  return {
    sessionId: "session-1",
    assistantId: "assistant-old",
    cwd: "/tmp/project",
    projectRoot: "/tmp/project",
    recentFiles: ["README.md"],
    recentToolCalls: [],
    approvals: [],
    turns: [],
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}
