import type { CliAgentEvent } from "@xpert-cli/contracts";

interface StreamState {
  runId?: string;
  threadId?: string;
}

export async function* adaptRunStream(
  stream: AsyncIterable<{ event?: string; data: unknown }>,
  state: StreamState,
): AsyncGenerator<CliAgentEvent> {
  for await (const chunk of stream) {
    const chunkEvent = (chunk.event ?? "").toLowerCase();
    if (chunkEvent === "metadata" && isRecord(chunk.data)) {
      state.runId = readString(chunk.data.run_id) ?? state.runId;
      state.threadId = readString(chunk.data.thread_id) ?? state.threadId;
      continue;
    }

    if (chunkEvent === "complete" || isCompletePayload(chunk.data)) {
      yield {
        type: "done",
        threadId: state.threadId,
        runId: state.runId,
      };
      continue;
    }

    if (chunkEvent === "error") {
      yield {
        type: "error",
        message: readErrorMessage(chunk.data),
      };
      continue;
    }

    yield* normalizePayload(chunk.data, state);
  }
}

function* normalizePayload(
  payload: unknown,
  state: StreamState,
): Generator<CliAgentEvent> {
  if (typeof payload === "string") {
    yield { type: "text_delta", text: payload };
    return;
  }

  if (Array.isArray(payload)) {
    for (const item of payload) {
      yield* normalizePayload(item, state);
    }
    return;
  }

  if (!isRecord(payload)) {
    return;
  }

  const payloadType = readString(payload.type)?.toLowerCase();
  if (payloadType === "message") {
    const message = payload.data;
    if (typeof message === "string") {
      yield { type: "text_delta", text: message };
      return;
    }
    if (isRecord(message)) {
      if (message.type === "text" && typeof message.text === "string") {
        yield { type: "text_delta", text: message.text };
        return;
      }
      if (message.type === "reasoning" && typeof message.text === "string") {
        yield { type: "reasoning", text: message.text };
      }
    }
    return;
  }

  if (payloadType === "event") {
    const eventType = readString(payload.event)?.toLowerCase();
    if (eventType === "on_message_start" || eventType === "on_agent_start" || eventType === "on_agent_end") {
      if (isRecord(payload.data)) {
        state.runId =
          readString(payload.data.executionId) ??
          readString(payload.data.execution_id) ??
          state.runId;
      }
    }

    if (eventType === "on_interrupt") {
      const toolCalls = collectToolCalls(payload.data);
      for (const toolCall of toolCalls) {
        yield {
          type: "tool_call",
          toolName: toolCall.name,
          callId: toolCall.id,
          interruptId: toolCall.interruptId,
          args: toolCall.args,
          runId: state.runId,
        };
      }
      return;
    }

    if (eventType === "on_chat_event" && isRecord(payload.data)) {
      if (payload.data.type === "thread_context_usage" && isRecord(payload.data.usage)) {
        yield {
          type: "usage",
          inputTokens: readNumber(payload.data.usage.inputTokens) ?? readNumber(payload.data.usage.input_tokens),
          outputTokens: readNumber(payload.data.usage.outputTokens) ?? readNumber(payload.data.usage.output_tokens),
          cost: readNumber(payload.data.usage.totalPrice) ?? readNumber(payload.data.usage.total_price),
        };
      }
      return;
    }

    return;
  }

  if (payloadType === "error") {
    yield {
      type: "error",
      message: readErrorMessage(payload.data ?? payload.message ?? payload),
    };
  }

  if ("messages" in payload && Array.isArray(payload.messages)) {
    for (const message of payload.messages) {
      yield* normalizePayload(message, state);
    }
  }
}

function collectToolCalls(payload: unknown): Array<{
  id: string;
  name: string;
  interruptId?: string;
  args: unknown;
}> {
  const toolCalls: Array<{ id: string; name: string; interruptId?: string; args: unknown }> = [];

  if (!isRecord(payload)) {
    return toolCalls;
  }

  const tasks = Array.isArray(payload.tasks) ? payload.tasks : [];
  for (const task of tasks) {
    if (!isRecord(task)) {
      continue;
    }

    if (isRecord(task.call)) {
      const id = readString(task.call.id);
      const name = readString(task.call.name);
      if (id && name) {
        toolCalls.push({
          id,
          name,
          interruptId: undefined,
          args: task.call.args,
        });
      }
    }

    const interrupts = Array.isArray(task.interrupts) ? task.interrupts : [];
    for (const interrupt of interrupts) {
      if (!isRecord(interrupt) || !isRecord(interrupt.value)) {
        continue;
      }

      const calls =
        asToolCallArray(interrupt.value.clientToolCalls) ??
        asToolCallArray(interrupt.value.toolCalls) ??
        asToolCallArray(interrupt.value.tool_calls);

      if (!calls) {
        continue;
      }

      for (const call of calls) {
        const id = readString(call.id);
        const name = readString(call.name);
        const interruptId = readString(interrupt.id);
        if (!id || !name) {
          continue;
        }
        toolCalls.push({
          id,
          name,
          interruptId,
          args: call.args,
        });
      }
    }
  }

  return toolCalls;
}

function asToolCallArray(value: unknown): Array<Record<string, unknown>> | null {
  if (!Array.isArray(value)) {
    return null;
  }

  return value.filter((item): item is Record<string, unknown> => isRecord(item));
}

function isCompletePayload(payload: unknown): boolean {
  return isRecord(payload) && readString(payload.type)?.toLowerCase() === "complete";
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === "object" && value !== null;
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function readNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function readErrorMessage(value: unknown): string {
  if (typeof value === "string" && value.trim()) {
    return value;
  }

  if (isRecord(value)) {
    for (const key of ["message", "error", "detail"]) {
      const message = value[key];
      if (typeof message === "string" && message.trim()) {
        return message;
      }
    }
  }

  return "Unknown stream error";
}
