import { describe, expect, it } from "vitest";
import {
  buildRemoteFingerprint,
  resetStaleRemoteStateIfNeeded,
} from "../runtime/remote-session.js";
import type { CliSessionState } from "../runtime/session-store.js";

describe("remote session fingerprint", () => {
  it("clears remote ids when apiUrl changes and preserves local state", () => {
    const session = createSession();
    session.remoteFingerprint = buildRemoteFingerprint(createConfig());
    session.threadId = "thread-1";
    session.runId = "run-1";
    session.checkpointId = "checkpoint-1";

    const result = resetStaleRemoteStateIfNeeded(
      session,
      createConfig({ apiUrl: "http://localhost:4000/api/ai" }),
    );

    expect(result).toMatchObject({
      changed: true,
      cleared: true,
      reasons: ["api_url_changed"],
      notice: "remote config changed; stale remote run state cleared",
    });
    expect(session.threadId).toBeUndefined();
    expect(session.runId).toBeUndefined();
    expect(session.checkpointId).toBeUndefined();
    expect(session.recentFiles).toEqual(["README.md"]);
    expect(session.approvals).toHaveLength(1);
    expect(session.turns).toHaveLength(1);
  });

  it("clears remote ids when assistantId changes", () => {
    const session = createSession();
    session.remoteFingerprint = buildRemoteFingerprint(createConfig());
    session.threadId = "thread-1";
    session.runId = "run-1";
    session.checkpointId = "checkpoint-1";

    const result = resetStaleRemoteStateIfNeeded(
      session,
      createConfig({ assistantId: "assistant-2" }),
    );

    expect(result.reasons).toEqual(["assistant_changed"]);
    expect(session.threadId).toBeUndefined();
    expect(session.runId).toBeUndefined();
    expect(session.checkpointId).toBeUndefined();
    expect(session.remoteFingerprint).toMatchObject({
      assistantId: "assistant-2",
    });
  });

  it("clears remote ids when organizationId changes", () => {
    const session = createSession();
    session.remoteFingerprint = buildRemoteFingerprint(createConfig());
    session.threadId = "thread-1";
    session.runId = "run-1";
    session.checkpointId = "checkpoint-1";

    const result = resetStaleRemoteStateIfNeeded(
      session,
      createConfig({ organizationId: "org-2" }),
    );

    expect(result.reasons).toEqual(["organization_changed"]);
    expect(session.threadId).toBeUndefined();
    expect(session.runId).toBeUndefined();
    expect(session.checkpointId).toBeUndefined();
  });

  it("clears remote ids when organizationId is added to an older fingerprint", () => {
    const session = createSession();
    session.remoteFingerprint = {
      apiUrl: "http://localhost:3000/api/ai",
      assistantId: "assistant-1",
    };
    session.threadId = "thread-1";
    session.runId = "run-1";
    session.checkpointId = "checkpoint-1";

    const result = resetStaleRemoteStateIfNeeded(session, createConfig());

    expect(result.reasons).toEqual(["organization_changed"]);
    expect(session.threadId).toBeUndefined();
    expect(session.runId).toBeUndefined();
    expect(session.checkpointId).toBeUndefined();
  });

  it("uses the legacy assistantId when an older session has no fingerprint yet", () => {
    const session = createSession();
    session.assistantId = "assistant-legacy";
    session.threadId = "thread-1";
    session.runId = "run-1";
    session.checkpointId = "checkpoint-1";

    const result = resetStaleRemoteStateIfNeeded(session, createConfig());

    expect(result.reasons).toEqual([
      "api_url_changed",
      "organization_changed",
      "assistant_changed",
    ]);
    expect(session.threadId).toBeUndefined();
    expect(session.runId).toBeUndefined();
    expect(session.checkpointId).toBeUndefined();
    expect(session.remoteFingerprint).toMatchObject({
      apiUrl: "http://localhost:3000/api/ai",
      assistantId: "assistant-1",
    });
  });
});

function createConfig(
  overrides?: Partial<{
    apiUrl: string;
    organizationId?: string;
    assistantId?: string;
  }>,
) {
  return {
    apiUrl: "http://localhost:3000/api/ai",
    organizationId: "org-1",
    assistantId: "assistant-1",
    ...overrides,
  };
}

function createSession(): CliSessionState {
  const now = new Date().toISOString();
  return {
    sessionId: "session-1",
    assistantId: "assistant-1",
    cwd: "/tmp/project",
    projectRoot: "/tmp/project",
    recentFiles: ["README.md"],
    recentToolCalls: [
      {
        id: "call-1",
        toolName: "Read",
        summary: "read README.md",
        status: "success",
        createdAt: now,
      },
    ],
    approvals: [
      {
        toolName: "Read",
        decision: "allow",
        riskLevel: "safe",
        scopeType: "tool",
        createdAt: now,
      },
    ],
    turns: [
      {
        turnId: "turn-1",
        prompt: "Read README.md",
        startedAt: now,
        finishedAt: now,
        status: "completed",
        assistantText: "done",
        toolEvents: [],
        permissionEvents: [],
        changedFiles: [],
      },
    ],
    createdAt: now,
    updatedAt: now,
  };
}
