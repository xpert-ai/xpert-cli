import type { ClientToolMessageInput } from "../sdk/tool-resume.js";

export const MAX_CONSECUTIVE_IDENTICAL_TOOL_CALLS = 2;

export type ToolCallGuardDecision =
  | { kind: "execute" }
  | { kind: "already_handled" }
  | { kind: "blocked"; reason: string };

export class ToolCallGuard {
  readonly #messagesByCallId = new Map<string, ClientToolMessageInput>();
  #lastSignature?: string;
  #consecutiveCount = 0;

  begin(call: { callId: string; toolName: string; args: unknown }): ToolCallGuardDecision {
    const cachedMessage = this.#messagesByCallId.get(call.callId);
    if (cachedMessage) {
      return {
        kind: "already_handled",
      };
    }

    const signature = buildToolCallSignature(call.toolName, call.args);
    if (signature === this.#lastSignature) {
      this.#consecutiveCount += 1;
    } else {
      this.#lastSignature = signature;
      this.#consecutiveCount = 1;
    }

    if (this.#consecutiveCount > MAX_CONSECUTIVE_IDENTICAL_TOOL_CALLS) {
      return {
        kind: "blocked",
        reason: `Blocked repeated ${call.toolName} call after ${this.#consecutiveCount} identical requests in a row`,
      };
    }

    return { kind: "execute" };
  }

  remember(callId: string, message: ClientToolMessageInput): void {
    this.#messagesByCallId.set(callId, message);
  }
}

export function buildToolCallSignature(toolName: string, args: unknown): string {
  return `${toolName}:${stableStringify(args)}`;
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }

  const entries = Object.entries(value as Record<string, unknown>).sort(([left], [right]) =>
    left.localeCompare(right),
  );

  return `{${entries
    .map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`)
    .join(",")}}`;
}
