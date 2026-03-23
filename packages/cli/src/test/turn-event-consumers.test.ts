import { describe, expect, it } from "vitest";
import {
  createTurnTranscriptConsumer,
  createWorkingSetConsumer,
} from "../runtime/turn-event-consumers.js";
import { TurnTranscriptRecorder } from "../runtime/turn-transcript.js";
import type { CliSessionState } from "../runtime/session-store.js";

describe("turn event consumers", () => {
  it("builds transcript summaries from the unified event stream", () => {
    const session = createSession();
    const recorder = new TurnTranscriptRecorder({
      prompt: "Patch src/app.ts",
    });
    const consume = createTurnTranscriptConsumer({ session, recorder });

    consume({
      type: "assistant_text_delta",
      text: "Checking the file.",
      sequence: 1,
      at: "2026-03-23T00:00:01.000Z",
    });
    consume({
      type: "permission_resolved",
      callId: "call-1",
      toolName: "Patch",
      riskLevel: "moderate",
      scope: "Patch src/app.ts",
      allowed: true,
      decision: "allow_session",
      remembered: true,
      target: "src/app.ts",
      reason: "modify src/app.ts",
      sequence: 2,
      at: "2026-03-23T00:00:02.000Z",
    });
    consume({
      type: "tool_completed",
      callId: "call-1",
      toolName: "Patch",
      argsSummary: "path=src/app.ts",
      summary: "src/app.ts +1 -1",
      status: "success",
      changedFiles: ["src/app.ts"],
      sequence: 3,
      at: "2026-03-23T00:00:03.000Z",
    });
    consume({
      type: "turn_finished",
      status: "completed",
      threadId: "thread-1",
      runId: "run-1",
      checkpointId: "checkpoint-1",
      sequence: 4,
      at: "2026-03-23T00:00:04.000Z",
    });

    expect(session.turns).toHaveLength(1);
    expect(session.turns[0]).toMatchObject({
      status: "completed",
      assistantText: "Checking the file.",
      threadId: "thread-1",
      runId: "run-1",
      checkpointId: "checkpoint-1",
      changedFiles: ["src/app.ts"],
    });
    expect(session.turns[0]?.toolEvents[0]).toMatchObject({
      callId: "call-1",
      toolName: "Patch",
      status: "success",
      resultSummary: "src/app.ts +1 -1",
    });
    expect(session.turns[0]?.permissionEvents[0]).toMatchObject({
      toolName: "Patch",
      decision: "allow_session",
      remembered: true,
      target: "src/app.ts",
    });
  });

  it("records cancellation and error details from terminal events", () => {
    const session = createSession();
    const recorder = new TurnTranscriptRecorder({
      prompt: "Run tests",
    });
    const consume = createTurnTranscriptConsumer({ session, recorder });

    consume({
      type: "turn_finished",
      status: "cancelled",
      error: "Turn cancelled",
      cancelled: true,
      sequence: 1,
      at: "2026-03-23T00:00:01.000Z",
    });

    expect(session.turns[0]).toMatchObject({
      status: "cancelled",
      error: "Turn cancelled",
      cancelled: true,
    });
  });

  it("updates recent tool calls and files from tool completion events", () => {
    const session = createSession();
    const consume = createWorkingSetConsumer(session);

    consume({
      type: "tool_completed",
      callId: "call-1",
      toolName: "Read",
      argsSummary: "path=README.md",
      summary: "read README.md",
      status: "success",
      sequence: 1,
      at: "2026-03-23T00:00:01.000Z",
    });
    consume({
      type: "tool_completed",
      callId: "call-2",
      toolName: "Patch",
      argsSummary: "path=src/app.ts",
      summary: "src/app.ts +1 -1",
      status: "success",
      changedFiles: ["src/app.ts", "README.md"],
      sequence: 2,
      at: "2026-03-23T00:00:02.000Z",
    });

    expect(session.recentToolCalls).toEqual([
      {
        id: "call-2",
        toolName: "Patch",
        summary: "src/app.ts +1 -1",
        status: "success",
        createdAt: "2026-03-23T00:00:02.000Z",
      },
      {
        id: "call-1",
        toolName: "Read",
        summary: "read README.md",
        status: "success",
        createdAt: "2026-03-23T00:00:01.000Z",
      },
    ]);
    expect(session.recentFiles).toEqual(["README.md", "src/app.ts"]);
  });
});

function createSession(): CliSessionState {
  const now = new Date().toISOString();
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
  };
}
