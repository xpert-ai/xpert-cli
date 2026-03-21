import type {
  ApprovalMode,
  PermissionRecord,
  PermissionRequest,
} from "@xpert-cli/contracts";
import type { CliSessionState } from "../runtime/session-store.js";
import { buildPermissionKey, resolveRiskLevel } from "./rules.js";
import { promptForPermission } from "../ui/permission.js";

export interface PermissionDecision {
  allowed: boolean;
  remembered?: boolean;
  riskLevel: PermissionRequest["riskLevel"];
  reason?: string;
  target?: string;
}

export class PermissionManager {
  readonly #session: CliSessionState;
  readonly #approvalMode: ApprovalMode;
  readonly #interactive: boolean;

  constructor(options: {
    session: CliSessionState;
    approvalMode: ApprovalMode;
    interactive: boolean;
  }) {
    this.#session = options.session;
    this.#approvalMode = options.approvalMode;
    this.#interactive = options.interactive;
  }

  get records(): PermissionRecord[] {
    return this.#session.approvals;
  }

  async request(toolName: string, args: unknown): Promise<PermissionDecision> {
    const { riskLevel, reason, target } = resolveRiskLevel(toolName, args);
    const key = buildPermissionKey(toolName, args);

    if (riskLevel === "safe") {
      return { allowed: true, riskLevel, reason, target };
    }

    if (this.#approvalMode === "auto" && riskLevel === "moderate") {
      return { allowed: true, riskLevel, reason, target };
    }

    const existing = this.#session.approvals.find((record) => record.key === key);
    if (existing) {
      return {
        allowed: existing.decision === "allow",
        remembered: true,
        riskLevel,
        reason,
        target,
      };
    }

    if (this.#approvalMode === "never" || !this.#interactive) {
      return { allowed: false, riskLevel, reason, target };
    }

    const result = await promptForPermission({
      toolName,
      riskLevel,
      reason,
      target,
    });

    if (result.outcome === "allow_session" && riskLevel === "moderate") {
      this.#session.approvals.push({
        key,
        decision: "allow",
        createdAt: new Date().toISOString(),
      });
      return { allowed: true, remembered: true, riskLevel, reason, target };
    }

    return {
      allowed: result.outcome === "allow_once",
      riskLevel,
      reason,
      target,
    };
  }
}
