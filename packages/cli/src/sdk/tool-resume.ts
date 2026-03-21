import type { ToolExecutionResult } from "../tools/contracts.js";

export interface ClientToolMessageInput {
  tool_call_id: string;
  name?: string;
  content: unknown;
  status?: "success" | "error";
  artifact?: unknown;
  interruptId?: string;
}

export function buildToolMessage(params: {
  callId: string;
  toolName: string;
  result: ToolExecutionResult;
  status?: "success" | "error";
  interruptId?: string;
}): ClientToolMessageInput {
  return {
    tool_call_id: params.callId,
    name: params.toolName,
    content: params.result.content,
    status: params.status ?? "success",
    artifact: params.result.artifact,
    interruptId: params.interruptId,
  };
}

export function buildResumeInput(params: {
  executionId: string;
  toolMessages: ClientToolMessageInput[];
}): Record<string, unknown> {
  const payload = buildResumePayload(params.toolMessages);

  return {
    action: "resume",
    target: {
      executionId: params.executionId,
    },
    decision: {
      type: "confirm",
      payload,
    },
  };
}

function buildResumePayload(toolMessages: ClientToolMessageInput[]): Record<string, unknown> {
  return {
    toolMessages: toolMessages.map(stripInterruptId),
  };
}

function stripInterruptId(message: ClientToolMessageInput): Omit<ClientToolMessageInput, "interruptId"> {
  const { interruptId: _interruptId, ...rest } = message;
  return rest;
}
