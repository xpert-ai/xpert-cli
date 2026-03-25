import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SessionStore } from "../runtime/session-store.js";

describe("SessionStore", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "xpert-cli-session-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("writes and reloads a session file", async () => {
    const store = new SessionStore(tempDir);
    const session = await store.create({
      cwd: "/tmp/project",
      projectRoot: "/tmp/project",
      assistantId: "assistant-1",
    });

    session.threadId = "thread-1";
    session.runId = "run-1";
    session.turns.push({
      turnId: "turn-1",
      prompt: "Read README.md",
      startedAt: "2026-03-21T00:00:00.000Z",
      finishedAt: "2026-03-21T00:00:01.000Z",
      threadId: "thread-1",
      runId: "run-1",
      checkpointId: "checkpoint-1",
      status: "completed",
      assistantText: "done",
      toolEvents: [],
      permissionEvents: [],
      changedFiles: [],
      renderItems: [
        {
          type: "user_prompt",
          text: "Read README.md",
        },
        {
          type: "assistant_text",
          text: "done",
        },
      ],
    });

    await store.save(session);
    const restored = await store.load(session.sessionId);

    expect(restored).toMatchObject({
      sessionId: session.sessionId,
      threadId: "thread-1",
      runId: "run-1",
      assistantId: "assistant-1",
    });
    expect(restored?.turns).toHaveLength(1);
    expect(restored?.turns[0]?.prompt).toBe("Read README.md");
    expect(restored?.turns[0]?.renderItems).toEqual([
      {
        type: "user_prompt",
        text: "Read README.md",
      },
      {
        type: "assistant_text",
        text: "done",
      },
    ]);
  });

  it("resolves the latest session for the current project root", async () => {
    const store = new SessionStore(tempDir);
    const projectSession = await store.create({
      cwd: "/tmp/project-a",
      projectRoot: "/tmp/project-a",
      assistantId: "assistant-a",
    });
    await store.save(projectSession);

    const otherProjectSession = await store.create({
      cwd: "/tmp/project-b",
      projectRoot: "/tmp/project-b",
      assistantId: "assistant-b",
    });
    await store.save(otherProjectSession);

    const resolved = await store.resolveLatestForProjectRoot("/tmp/project-a");

    expect(resolved?.sessionId).toBe(projectSession.sessionId);
    expect(resolved?.projectRoot).toBe("/tmp/project-a");
  });

  it("loads an older session file that does not have a remote fingerprint", async () => {
    const store = new SessionStore(tempDir);
    const sessionPath = store.getSessionPath("legacy-session");
    await store.ensure();
    await writeFile(
      sessionPath,
      `${JSON.stringify({
        sessionId: "legacy-session",
        assistantId: "assistant-legacy",
        threadId: "thread-legacy",
        runId: "run-legacy",
        checkpointId: "checkpoint-legacy",
        cwd: "/tmp/project",
        projectRoot: "/tmp/project",
        approvals: [],
        recentFiles: ["README.md"],
        recentToolCalls: [],
        turns: [],
        createdAt: "2026-03-21T00:00:00.000Z",
        updatedAt: "2026-03-21T00:00:01.000Z",
      }, null, 2)}\n`,
      "utf8",
    );

    const restored = await store.load("legacy-session");

    expect(restored).toMatchObject({
      sessionId: "legacy-session",
      assistantId: "assistant-legacy",
      threadId: "thread-legacy",
      runId: "run-legacy",
      checkpointId: "checkpoint-legacy",
      remoteFingerprint: undefined,
    });
    expect(restored?.turns).toEqual([]);
  });

  it("loads legacy turns that do not yet contain render items", async () => {
    const store = new SessionStore(tempDir);
    const sessionPath = store.getSessionPath("legacy-render-session");
    await store.ensure();
    await writeFile(
      sessionPath,
      `${JSON.stringify({
        sessionId: "legacy-render-session",
        assistantId: "assistant-legacy",
        cwd: "/tmp/project",
        projectRoot: "/tmp/project",
        approvals: [],
        recentFiles: [],
        recentToolCalls: [],
        turns: [
          {
            turnId: "turn-1",
            prompt: "Read README.md",
            startedAt: "2026-03-21T00:00:00.000Z",
            finishedAt: "2026-03-21T00:00:01.000Z",
            status: "completed",
            assistantText: "done",
            toolEvents: [],
            permissionEvents: [],
            changedFiles: [],
          },
        ],
        createdAt: "2026-03-21T00:00:00.000Z",
        updatedAt: "2026-03-21T00:00:01.000Z",
      }, null, 2)}\n`,
      "utf8",
    );

    const restored = await store.load("legacy-render-session");

    expect(restored?.turns[0]?.renderItems).toEqual([]);
  });
});
