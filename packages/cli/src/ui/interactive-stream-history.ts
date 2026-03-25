import type { PersistedTurnRenderItem } from "../runtime/render-transcript.js";
import type { TurnEvent, TurnEventInput } from "../runtime/turn-events.js";
import type { UiEvent } from "./events.js";

const STREAM_TEXT_SOFT_LIMIT = 600;
const STREAM_TEXT_TRAILING_CHARS = 200;

export interface InteractiveStreamBuffers {
  assistant: string;
  reasoning: string;
}

export interface InteractiveStreamUpdate {
  items: PersistedTurnRenderItem[];
  buffers: InteractiveStreamBuffers;
}

export function createInteractiveStreamBuffers(): InteractiveStreamBuffers {
  return {
    assistant: "",
    reasoning: "",
  };
}

export function streamInteractiveTurnEvent(
  current: InteractiveStreamBuffers,
  event: UiEvent | TurnEvent | TurnEventInput,
): InteractiveStreamUpdate {
  switch (event.type) {
    case "assistant_text":
    case "assistant_text_delta":
      return appendStreamText(current, "assistant", event.text);
    case "reasoning":
      return appendStreamText(current, "reasoning", event.text);
    case "tool_requested":
    case "tool_call": {
      const flushed = flushInteractiveStreamBuffers(current);
      return {
        buffers: flushed.buffers,
        items: [
          ...flushed.items,
          {
            type: "tool_call",
            callId: "callId" in event ? event.callId : undefined,
            toolName: event.toolName,
            target: event.target,
            argsSummary: "argsSummary" in event ? event.argsSummary : undefined,
          },
        ],
      };
    }
    case "tool_output_line":
    case "bash_line": {
      const flushed = flushInteractiveStreamBuffers(current);
      return {
        buffers: flushed.buffers,
        items: [
          ...flushed.items,
          {
            type: "bash_line",
            callId: "callId" in event ? event.callId : undefined,
            toolName: "toolName" in event ? event.toolName : undefined,
            text: event.line,
          },
        ],
      };
    }
    case "tool_diff":
    case "diff": {
      const flushed = flushInteractiveStreamBuffers(current);
      return {
        buffers: flushed.buffers,
        items: [
          ...flushed.items,
          {
            type: "diff",
            callId: "callId" in event ? event.callId : undefined,
            toolName: "toolName" in event ? event.toolName : undefined,
            path: "path" in event ? event.path : undefined,
            text: event.diffText,
          },
        ],
      };
    }
    case "tool_completed":
    case "tool_ack": {
      const flushed = flushInteractiveStreamBuffers(current);
      return {
        buffers: flushed.buffers,
        items: [
          ...flushed.items,
          {
            type: "tool_result",
            callId: "callId" in event ? event.callId : undefined,
            toolName: event.toolName,
            summary: event.summary,
            status: "status" in event ? event.status : "success",
          },
        ],
      };
    }
    case "warning": {
      if ("code" in event && event.code === "STALE_THREAD_RETRY") {
        return {
          items: [],
          buffers: current,
        };
      }
      const flushed = flushInteractiveStreamBuffers(current);
      return {
        buffers: flushed.buffers,
        items: [
          ...flushed.items,
          {
            type: "warning",
            callId: "callId" in event ? event.callId : undefined,
            toolName: "toolName" in event ? event.toolName : undefined,
            code: "code" in event ? event.code : undefined,
            text: event.message,
          },
        ],
      };
    }
    case "error": {
      const flushed = flushInteractiveStreamBuffers(current);
      return {
        buffers: flushed.buffers,
        items: [
          ...flushed.items,
          {
            type: "error",
            callId: "callId" in event ? event.callId : undefined,
            toolName: "toolName" in event ? event.toolName : undefined,
            code: "code" in event ? event.code : undefined,
            text: event.message,
          },
        ],
      };
    }
    default:
      return {
        items: [],
        buffers: current,
      };
  }
}

export function flushInteractiveStreamBuffers(
  current: InteractiveStreamBuffers,
): InteractiveStreamUpdate {
  const items: PersistedTurnRenderItem[] = [];

  if (current.assistant.length > 0) {
    items.push({
      type: "assistant_text",
      text: current.assistant,
    });
  }
  if (current.reasoning.length > 0) {
    items.push({
      type: "reasoning",
      text: current.reasoning,
    });
  }

  return {
    items,
    buffers: createInteractiveStreamBuffers(),
  };
}

export function splitFlushableStreamText(input: string): {
  flushText: string;
  remainder: string;
} {
  if (input.length <= STREAM_TEXT_SOFT_LIMIT) {
    return {
      flushText: "",
      remainder: input,
    };
  }

  const splitAt = Math.max(
    STREAM_TEXT_SOFT_LIMIT - STREAM_TEXT_TRAILING_CHARS,
    input.length - STREAM_TEXT_TRAILING_CHARS,
  );

  return {
    flushText: input.slice(0, splitAt),
    remainder: input.slice(splitAt),
  };
}

function appendStreamText(
  current: InteractiveStreamBuffers,
  key: "assistant" | "reasoning",
  text: string,
): InteractiveStreamUpdate {
  const otherKey = key === "assistant" ? "reasoning" : "assistant";
  const flushedOther =
    current[otherKey].length > 0
      ? flushInteractiveStreamBuffers(current)
      : {
          items: [],
          buffers: current,
        };
  const nextBuffers: InteractiveStreamBuffers = {
    ...flushedOther.buffers,
    [key]: flushedOther.buffers[key] + text,
  };
  const split = splitFlushableStreamText(nextBuffers[key]);

  if (!split.flushText) {
    return {
      items: flushedOther.items,
      buffers: nextBuffers,
    };
  }

  return {
    items: [
      ...flushedOther.items,
      {
        type: key === "assistant" ? "assistant_text" : "reasoning",
        text: split.flushText,
      },
    ],
    buffers: {
      ...nextBuffers,
      [key]: split.remainder,
    },
  };
}
