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
});

function createConfig() {
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
  };
}

function createSession(): CliSessionState {
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
  };
}
