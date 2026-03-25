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

  it("lists sessions by updatedAt desc, filters by project root, and skips broken files", async () => {
    const store = new SessionStore(tempDir);
    await store.ensure();
    await writeFile(
      store.getSessionPath("session-a"),
      `${JSON.stringify(
        createRawSession({
          sessionId: "session-a",
          projectRoot: "/tmp/project-a",
          cwd: "/tmp/project-a",
          updatedAt: "2026-03-25T00:00:02.000Z",
        }),
        null,
        2,
      )}\n`,
      "utf8",
    );
    await writeFile(
      store.getSessionPath("session-b"),
      `${JSON.stringify(
        createRawSession({
          sessionId: "session-b",
          projectRoot: "/tmp/project-a",
          cwd: "/tmp/project-a/packages/cli",
          updatedAt: "2026-03-25T00:00:03.000Z",
        }),
        null,
        2,
      )}\n`,
      "utf8",
    );
    await writeFile(
      store.getSessionPath("session-c"),
      `${JSON.stringify(
        createRawSession({
          sessionId: "session-c",
          projectRoot: "/tmp/project-b",
          cwd: "/tmp/project-b",
          updatedAt: "2026-03-25T00:00:01.000Z",
        }),
        null,
        2,
      )}\n`,
      "utf8",
    );
    await writeFile(store.getSessionPath("broken"), "{not-json}\n", "utf8");

    const allSessions = await store.list();
    const filteredSessions = await store.list({ projectRoot: "/tmp/project-a" });

    expect(allSessions.map((session) => session.sessionId)).toEqual([
      "session-b",
      "session-a",
      "session-c",
    ]);
    expect(filteredSessions.map((session) => session.sessionId)).toEqual([
      "session-b",
      "session-a",
    ]);
  });

  it("deletes a selected session file", async () => {
    const store = new SessionStore(tempDir);
    const session = await store.create({
      cwd: "/tmp/project",
      projectRoot: "/tmp/project",
      assistantId: "assistant-1",
    });

    await store.save(session);
    expect(await store.load(session.sessionId)).not.toBeNull();

    expect(await store.delete(session.sessionId)).toBe(true);
    expect(await store.load(session.sessionId)).toBeNull();
  });

  it("uses the filename as the canonical local session id when payload ids are missing or mismatched", async () => {
    const store = new SessionStore(tempDir);
    await store.ensure();
    await writeFile(
      store.getSessionPath("missing-id"),
      `${JSON.stringify(
        {
          ...createRawSession({
            updatedAt: "2026-03-25T00:00:02.000Z",
          }),
          sessionId: undefined,
        },
        null,
        2,
      )}\n`,
      "utf8",
    );
    await writeFile(
      store.getSessionPath("mismatched-id"),
      `${JSON.stringify(
        createRawSession({
          sessionId: "payload-id",
          updatedAt: "2026-03-25T00:00:03.000Z",
        }),
        null,
        2,
      )}\n`,
      "utf8",
    );

    const firstPass = await store.list();
    const secondPass = await store.list();

    expect(firstPass.map((session) => session.sessionId)).toEqual([
      "mismatched-id",
      "missing-id",
    ]);
    expect(secondPass.map((session) => session.sessionId)).toEqual([
      "mismatched-id",
      "missing-id",
    ]);
    expect((await store.load("missing-id"))?.sessionId).toBe("missing-id");
    expect((await store.load("mismatched-id"))?.sessionId).toBe("mismatched-id");
    expect(await store.delete("missing-id")).toBe(true);
    expect(await store.delete("mismatched-id")).toBe(true);
  });

  it("prunes older sessions and keeps the newest N within scope", async () => {
    const store = new SessionStore(tempDir);
    await store.ensure();
    await Promise.all([
      writeFile(
        store.getSessionPath("keep-newest"),
        `${JSON.stringify(
          createRawSession({
            sessionId: "keep-newest",
            projectRoot: "/tmp/project-a",
            cwd: "/tmp/project-a",
            updatedAt: "2026-03-25T00:00:03.000Z",
          }),
          null,
          2,
        )}\n`,
        "utf8",
      ),
      writeFile(
        store.getSessionPath("delete-old-1"),
        `${JSON.stringify(
          createRawSession({
            sessionId: "delete-old-1",
            projectRoot: "/tmp/project-a",
            cwd: "/tmp/project-a",
            updatedAt: "2026-03-25T00:00:02.000Z",
          }),
          null,
          2,
        )}\n`,
        "utf8",
      ),
      writeFile(
        store.getSessionPath("delete-old-2"),
        `${JSON.stringify(
          createRawSession({
            sessionId: "delete-old-2",
            projectRoot: "/tmp/project-a",
            cwd: "/tmp/project-a",
            updatedAt: "2026-03-25T00:00:01.000Z",
          }),
          null,
          2,
        )}\n`,
        "utf8",
      ),
      writeFile(
        store.getSessionPath("other-project"),
        `${JSON.stringify(
          createRawSession({
            sessionId: "other-project",
            projectRoot: "/tmp/project-b",
            cwd: "/tmp/project-b",
            updatedAt: "2026-03-25T00:00:04.000Z",
          }),
          null,
          2,
        )}\n`,
        "utf8",
      ),
    ]);

    const result = await store.prune({
      keep: 1,
      projectRoot: "/tmp/project-a",
    });
    const remaining = await store.list();

    expect(result.kept.map((session) => session.sessionId)).toEqual(["keep-newest"]);
    expect(result.deleted.map((session) => session.sessionId)).toEqual([
      "delete-old-1",
      "delete-old-2",
    ]);
    expect(remaining.map((session) => session.sessionId)).toEqual([
      "other-project",
      "keep-newest",
    ]);
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

function createRawSession(overrides: Record<string, unknown>) {
  return {
    sessionId: "session-1",
    assistantId: "assistant-1",
    cwd: "/tmp/project",
    projectRoot: "/tmp/project",
    approvals: [],
    recentFiles: [],
    recentToolCalls: [],
    turns: [],
    createdAt: "2026-03-25T00:00:00.000Z",
    updatedAt: "2026-03-25T00:00:00.000Z",
    ...overrides,
  };
}
