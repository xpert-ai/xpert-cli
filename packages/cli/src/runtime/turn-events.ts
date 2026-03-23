import type { RiskLevel } from "@xpert-cli/contracts";

export type TurnLifecycleState =
  | "running"
  | "completed"
  | "cancelled"
  | "failed";

export type ToolCompletionStatus = "success" | "error" | "denied";

interface TurnEventBase<TType extends string> {
  type: TType;
  sequence: number;
  at: string;
}

export interface TurnStartedEvent extends TurnEventBase<"turn_started"> {
  prompt: string;
  threadId?: string;
  runId?: string;
  checkpointId?: string;
}

export interface AssistantTextDeltaEvent
  extends TurnEventBase<"assistant_text_delta"> {
  text: string;
}

export interface ReasoningEvent extends TurnEventBase<"reasoning"> {
  text: string;
}

export interface ToolRequestedEvent extends TurnEventBase<"tool_requested"> {
  callId: string;
  toolName: string;
  argsSummary: string;
  target?: string;
  interruptId?: string;
}

export interface PermissionRequestedEvent
  extends TurnEventBase<"permission_requested"> {
  callId: string;
  toolName: string;
  riskLevel: RiskLevel;
  scope?: string;
  target?: string;
  reason?: string;
}

export interface PermissionResolvedEvent
  extends TurnEventBase<"permission_resolved"> {
  callId: string;
  toolName: string;
  riskLevel: RiskLevel;
  scope?: string;
  allowed: boolean;
  decision: string;
  remembered?: boolean;
  target?: string;
  reason?: string;
}

export interface ToolOutputLineEvent extends TurnEventBase<"tool_output_line"> {
  callId: string;
  toolName: string;
  line: string;
}

export interface ToolDiffEvent extends TurnEventBase<"tool_diff"> {
  callId: string;
  toolName: string;
  diffText: string;
  path?: string;
}

export interface ToolCompletedEvent extends TurnEventBase<"tool_completed"> {
  callId: string;
  toolName: string;
  argsSummary: string;
  status: ToolCompletionStatus;
  summary: string;
  code?: string;
  changedFiles?: string[];
}

export interface WarningEvent extends TurnEventBase<"warning"> {
  message: string;
  callId?: string;
  toolName?: string;
  code?: string;
}

export interface ErrorEvent extends TurnEventBase<"error"> {
  message: string;
  callId?: string;
  toolName?: string;
  code?: string;
}

export interface CheckpointUpdatedEvent
  extends TurnEventBase<"checkpoint_updated"> {
  checkpointId?: string;
  threadId?: string;
  runId?: string;
}

export interface TurnFinishedEvent extends TurnEventBase<"turn_finished"> {
  status: "completed" | "cancelled" | "failed";
  threadId?: string;
  runId?: string;
  checkpointId?: string;
  error?: string;
  cancelled?: boolean;
}

export type TurnEvent =
  | TurnStartedEvent
  | AssistantTextDeltaEvent
  | ReasoningEvent
  | ToolRequestedEvent
  | PermissionRequestedEvent
  | PermissionResolvedEvent
  | ToolOutputLineEvent
  | ToolDiffEvent
  | ToolCompletedEvent
  | WarningEvent
  | ErrorEvent
  | CheckpointUpdatedEvent
  | TurnFinishedEvent;

type DistributiveOmit<TValue, TKey extends keyof any> = TValue extends any
  ? Omit<TValue, TKey>
  : never;

export type TurnEventInput = DistributiveOmit<TurnEvent, "sequence" | "at">;

export function createTurnEventBuilder(): (
  event: TurnEventInput,
) => TurnEvent {
  let sequence = 0;

  return (event: TurnEventInput): TurnEvent =>
    ({
      ...event,
      sequence: ++sequence,
      at: new Date().toISOString(),
    }) as TurnEvent;
}

export function getNextTurnLifecycleState(
  current: TurnLifecycleState,
  event: TurnEvent,
): TurnLifecycleState {
  switch (event.type) {
    case "turn_started":
      return "running";
    case "turn_finished":
      switch (event.status) {
        case "completed":
          return "completed";
        case "cancelled":
          return "cancelled";
        case "failed":
          return "failed";
      }
  }

  return current;
}
