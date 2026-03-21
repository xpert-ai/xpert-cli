export type CliAgentEvent =
  | { type: "text_delta"; text: string }
  | { type: "reasoning"; text: string }
  | {
      type: "tool_call";
      toolName: string;
      callId: string;
      interruptId?: string;
      args: unknown;
      runId?: string;
    }
  | { type: "tool_result_ack"; callId: string }
  | { type: "usage"; inputTokens?: number; outputTokens?: number; cost?: number }
  | { type: "checkpoint"; checkpointId: string; threadId?: string; runId?: string }
  | { type: "done"; threadId?: string; runId?: string }
  | { type: "error"; message: string };
