import { describe, expect, it } from "vitest";
import {
  buildSessionSummary,
  SESSION_SUMMARY_LIMITS,
} from "../runtime/session-summary.js";
import type { CliSessionState } from "../runtime/session-store.js";

describe("buildSessionSummary", () => {
  it("builds a stable title from the first meaningful prompt", () => {
    const summary = buildSessionSummary(
      createSession({
        turns: [
          createTurn({
            prompt: "   \n   ",
            startedAt: "2026-03-25T00:00:01.000Z",
          }),
          createTurn({
            prompt: "Read README.md and explain the CLI flow",
            startedAt: "2026-03-25T00:00:02.000Z",
          }),
        ],
      }),
    );

    expect(summary.title).toBe("Read README.md and explain the CLI flow");
  });

  it("uses the latest prompt as the preview and tracks the last turn status", () => {
    const summary = buildSessionSummary(
      createSession({
        threadId: "thread-1",
        turns: [
          createTurn({
            prompt: "First prompt",
            startedAt: "2026-03-25T00:00:01.000Z",
          }),
          createTurn({
            prompt: "Fix request error handling in cli.ts",
            status: "cancelled",
            startedAt: "2026-03-25T00:00:04.000Z",
            finishedAt: "2026-03-25T00:00:05.000Z",
          }),
        ],
      }),
    );

    expect(summary.latestPromptPreview).toBe("Fix request error handling in cli.ts");
    expect(summary.lastTurnStatus).toBe("cancelled");
    expect(summary.lastActivityAt).toBe("2026-03-25T00:00:05.000Z");
    expect(summary.hasRemoteState).toBe(true);
  });

  it("returns explicit empty fallbacks for sessions without turns", () => {
    const summary = buildSessionSummary(createSession());

    expect(summary.title).toBe("(empty session)");
    expect(summary.latestPromptPreview).toBe("");
    expect(summary.turnCount).toBe(0);
    expect(summary.lastTurnStatus).toBe("empty");
    expect(summary.lastActivityAt).toBe("2026-03-25T00:00:00.000Z");
  });

  it("clips long title and latest prompt preview values", () => {
    const prompt = `Read ${"very long prompt ".repeat(12)}`.trim();
    const summary = buildSessionSummary(
      createSession({
        turns: [createTurn({ prompt, startedAt: "2026-03-25T00:00:01.000Z" })],
      }),
    );

    expect(summary.title.length).toBe(SESSION_SUMMARY_LIMITS.titleChars);
    expect(summary.latestPromptPreview.length).toBe(
      SESSION_SUMMARY_LIMITS.latestPromptPreviewChars,
    );
    expect(summary.title.endsWith("...")).toBe(true);
    expect(summary.latestPromptPreview.endsWith("...")).toBe(true);
  });
});

function createSession(
  overrides: Partial<CliSessionState> = {},
): CliSessionState {
  return {
    sessionId: "28dfbacc-1111-2222-3333-444444444444",
    assistantId: "assistant-1",
    cwd: "/tmp/project",
    projectRoot: "/tmp/project",
    recentFiles: [],
    recentToolCalls: [],
    approvals: [],
    turns: [],
    createdAt: "2026-03-25T00:00:00.000Z",
    updatedAt: "2026-03-25T00:00:00.000Z",
    ...overrides,
  };
}

function createTurn(
  overrides: Partial<CliSessionState["turns"][number]> = {},
): CliSessionState["turns"][number] {
  return {
    turnId: "turn-1",
    prompt: "Read README.md",
    startedAt: "2026-03-25T00:00:01.000Z",
    finishedAt: "2026-03-25T00:00:02.000Z",
    status: "completed",
    toolEvents: [],
    permissionEvents: [],
    changedFiles: [],
    ...overrides,
  };
}
