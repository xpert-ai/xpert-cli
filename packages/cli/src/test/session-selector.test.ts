import { describe, expect, it } from "vitest";
import {
  findMatchingSessions,
  resolveSessionSelector,
} from "../runtime/session-selector.js";
import type { CliSessionState } from "../runtime/session-store.js";

describe("session selector", () => {
  const sessions = [
    createSession("28dfbacc-1111-2222-3333-444444444444"),
    createSession("28dfbeef-1111-2222-3333-444444444444"),
    createSession("9a71c3d2-1111-2222-3333-444444444444"),
  ];

  it("matches a full session id exactly", () => {
    const resolution = resolveSessionSelector(
      sessions,
      "28dfbacc-1111-2222-3333-444444444444",
    );

    expect(resolution).toMatchObject({
      ok: true,
      matchType: "exact",
      session: {
        sessionId: "28dfbacc-1111-2222-3333-444444444444",
      },
    });
  });

  it("matches a unique prefix", () => {
    const resolution = resolveSessionSelector(sessions, "9a71");

    expect(resolution).toMatchObject({
      ok: true,
      matchType: "prefix",
      session: {
        sessionId: "9a71c3d2-1111-2222-3333-444444444444",
      },
    });
  });

  it("returns all matching sessions for an ambiguous prefix", () => {
    const matches = findMatchingSessions(sessions, "28df");
    const resolution = resolveSessionSelector(sessions, "28df");

    expect(matches).toHaveLength(2);
    expect(resolution).toMatchObject({
      ok: false,
      reason: "ambiguous",
      matches: [
        { sessionId: "28dfbacc-1111-2222-3333-444444444444" },
        { sessionId: "28dfbeef-1111-2222-3333-444444444444" },
      ],
    });
  });

  it("returns not_found when nothing matches", () => {
    const resolution = resolveSessionSelector(sessions, "missing");

    expect(resolution).toMatchObject({
      ok: false,
      reason: "not_found",
      matches: [],
    });
  });
});

function createSession(sessionId: string): CliSessionState {
  const now = "2026-03-25T00:00:00.000Z";
  return {
    sessionId,
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
