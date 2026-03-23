import type { ToolCallSummary } from "@xpert-cli/contracts";
import type { CliSessionState } from "./session-store.js";
import {
  pushTurnTranscript,
  TurnTranscriptRecorder,
} from "./turn-transcript.js";
import { pushRecentFile, pushToolSummary } from "./working-set.js";
import type { TurnEvent, TurnEventInput } from "./turn-events.js";
import { createTurnEventBuilder } from "./turn-events.js";
import type { UiSink } from "../ui/sink.js";

export type TurnEventConsumer = (event: TurnEvent) => void;

export function createTurnEventDispatcher(
  consumers: TurnEventConsumer[],
): (event: TurnEventInput) => TurnEvent {
  const buildEvent = createTurnEventBuilder();

  return (event: TurnEventInput): TurnEvent => {
    const enriched = buildEvent(event);
    for (const consumer of consumers) {
      consumer(enriched);
    }
    return enriched;
  };
}

export function createUiTurnEventConsumer(ui: UiSink): TurnEventConsumer {
  return (event) => {
    ui.consume(event);
  };
}

export function createSessionRuntimeConsumer(
  session: CliSessionState,
): TurnEventConsumer {
  return (event) => {
    switch (event.type) {
      case "turn_started":
        if (event.threadId) {
          session.threadId = event.threadId;
        }
        if (event.runId) {
          session.runId = event.runId;
        }
        if (event.checkpointId) {
          session.checkpointId = event.checkpointId;
        }
        return;
      case "checkpoint_updated":
        if (event.threadId) {
          session.threadId = event.threadId;
        }
        if (event.runId) {
          session.runId = event.runId;
        }
        if (event.checkpointId !== undefined) {
          session.checkpointId = event.checkpointId;
        }
        return;
      case "turn_finished":
        if (event.threadId) {
          session.threadId = event.threadId;
        }
        if (event.runId) {
          session.runId = event.runId;
        }
        if (event.checkpointId !== undefined) {
          session.checkpointId = event.checkpointId;
        }
        return;
      default:
        return;
    }
  };
}

export function createWorkingSetConsumer(
  session: CliSessionState,
): TurnEventConsumer {
  return (event) => {
    if (event.type !== "tool_completed") {
      return;
    }

    session.recentToolCalls = pushToolSummary(session.recentToolCalls, {
      id: event.callId,
      toolName: event.toolName as ToolCallSummary["toolName"],
      summary: event.summary,
      status: event.status,
      createdAt: event.at,
    });

    for (const filePath of event.changedFiles ?? []) {
      session.recentFiles = pushRecentFile(session.recentFiles, filePath);
    }
  };
}

export function createTurnTranscriptConsumer(options: {
  session: CliSessionState;
  recorder: TurnTranscriptRecorder;
}): TurnEventConsumer {
  let finalized = false;

  return (event) => {
    if (finalized) {
      return;
    }

    if (event.type === "turn_finished") {
      options.session.turns = pushTurnTranscript(
        options.session.turns ?? [],
        options.recorder.finish({
          status: event.status === "failed" ? "error" : event.status,
          threadId: event.threadId,
          runId: event.runId,
          checkpointId: event.checkpointId,
          error: event.error,
          cancelled: event.cancelled,
        }),
      );
      finalized = true;
      return;
    }

    options.recorder.consume(event);
  };
}
