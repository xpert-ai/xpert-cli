import type { ToolExecutionResult } from "../tools/contracts.js";

export const MAX_TOOL_CALLS_PER_TURN = 12;
export const TOOL_CALL_BUDGET_EXCEEDED = "TOOL_CALL_BUDGET_EXCEEDED";

export type ToolCallBudgetDecision =
  | {
      kind: "ok";
      used: number;
      limit: number;
    }
  | {
      kind: "exceeded";
      used: number;
      limit: number;
      code: typeof TOOL_CALL_BUDGET_EXCEEDED;
      message: string;
    };

export class ToolCallBudget {
  readonly #limit: number;
  #used = 0;

  constructor(limit = MAX_TOOL_CALLS_PER_TURN) {
    this.#limit = limit;
  }

  get used(): number {
    return this.#used;
  }

  get limit(): number {
    return this.#limit;
  }

  consume(): ToolCallBudgetDecision {
    if (this.#used >= this.#limit) {
      return {
        kind: "exceeded",
        used: this.#used,
        limit: this.#limit,
        code: TOOL_CALL_BUDGET_EXCEEDED,
        message: buildBudgetExceededMessage(this.#used, this.#limit),
      };
    }

    this.#used += 1;
    return {
      kind: "ok",
      used: this.#used,
      limit: this.#limit,
    };
  }
}

export function toToolBudgetExceededResult(
  decision: Extract<ToolCallBudgetDecision, { kind: "exceeded" }>,
): ToolExecutionResult {
  return {
    summary: decision.message,
    content: decision.message,
    artifact: {
      code: decision.code,
      used: decision.used,
      limit: decision.limit,
      suggestion: "Continue with the results already collected in this turn.",
    },
  };
}

function buildBudgetExceededMessage(used: number, limit: number): string {
  return (
    `${TOOL_CALL_BUDGET_EXCEEDED}: This turn already used ${used} tool call${used === 1 ? "" : "s"}, ` +
    `which is the maximum allowed (${limit}). Do not call more tools in this turn. ` +
    "Continue with the results you already have and answer the user directly."
  );
}
