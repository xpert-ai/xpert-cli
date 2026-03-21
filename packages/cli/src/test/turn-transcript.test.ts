import { describe, expect, it } from "vitest";
import {
  TURN_TRANSCRIPT_LIMITS,
  TurnTranscriptRecorder,
  pushTurnTranscript,
} from "../runtime/turn-transcript.js";

describe("turn transcript", () => {
  it("clips large content and caps per-turn event counts", () => {
    const recorder = new TurnTranscriptRecorder({
      prompt: "prompt ".repeat(400),
      threadId: "thread-1",
      runId: "run-1",
      checkpointId: "checkpoint-1",
    });

    recorder.appendAssistantText("assistant ".repeat(500));
    for (let index = 0; index < TURN_TRANSCRIPT_LIMITS.toolEvents + 5; index += 1) {
      recorder.recordToolEvent({
        callId: `call-${index}`,
        toolName: "Read",
        argsSummary: `path=${"file.ts ".repeat(40)}`,
        resultSummary: `summary ${index} ${"x".repeat(200)}`,
        status: "success",
      });
    }
    for (let index = 0; index < TURN_TRANSCRIPT_LIMITS.permissionEvents + 5; index += 1) {
      recorder.recordPermissionEvent({
        toolName: "Bash",
        riskLevel: "moderate",
        decision: "allow_session",
        scope: `Bash pnpm test ${"scope ".repeat(40)}`,
        target: "pnpm test",
        reason: `reason ${"x".repeat(200)}`,
      });
    }
    recorder.addChangedFiles(
      Array.from(
        { length: TURN_TRANSCRIPT_LIMITS.changedFiles + 5 },
        (_, index) => `packages/file-${index}.ts`,
      ),
    );

    const turn = recorder.finish({
      status: "error",
      error: "x".repeat(TURN_TRANSCRIPT_LIMITS.errorChars + 100),
    });

    expect(turn.prompt.length).toBeLessThanOrEqual(TURN_TRANSCRIPT_LIMITS.promptChars);
    expect(turn.assistantText?.length).toBeLessThanOrEqual(TURN_TRANSCRIPT_LIMITS.assistantChars);
    expect(turn.toolEvents).toHaveLength(TURN_TRANSCRIPT_LIMITS.toolEvents);
    expect(turn.permissionEvents).toHaveLength(TURN_TRANSCRIPT_LIMITS.permissionEvents);
    expect(turn.changedFiles).toHaveLength(TURN_TRANSCRIPT_LIMITS.changedFiles);
    expect(turn.toolEvents[0]?.callId).toBe("call-5");
    expect(turn.error?.length).toBeLessThanOrEqual(TURN_TRANSCRIPT_LIMITS.errorChars);
  });

  it("caps the total number of persisted turns", () => {
    const turns = Array.from({ length: TURN_TRANSCRIPT_LIMITS.maxTurns + 3 }, (_, index) =>
      new TurnTranscriptRecorder({
        prompt: `prompt ${index}`,
        threadId: `thread-${index}`,
      }).finish({ status: "completed" }),
    ).reduce((current, turn) => pushTurnTranscript(current, turn), [] as ReturnType<typeof pushTurnTranscript>);

    expect(turns).toHaveLength(TURN_TRANSCRIPT_LIMITS.maxTurns);
    expect(turns[0]?.prompt).toBe("prompt 3");
    expect(turns.at(-1)?.prompt).toBe(`prompt ${TURN_TRANSCRIPT_LIMITS.maxTurns + 2}`);
  });
});
