import type {
  ApprovalMode,
  PermissionRecord,
  PermissionRequest,
} from "@xpert-cli/contracts";
import type { CliSessionState } from "../runtime/session-store.js";
import {
  createPermissionRecord,
  matchesPermissionRecord,
  resolvePermissionScope,
} from "./rules.js";
import {
  promptForPermission,
  type PermissionPromptHandler,
} from "../ui/permission.js";

export interface PermissionDecision {
  allowed: boolean;
  remembered?: boolean;
  riskLevel: PermissionRequest["riskLevel"];
  reason?: string;
  target?: string;
  scope: string;
  outcome:
    | "safe_allow"
    | "auto_allow"
    | "remembered_allow"
    | "remembered_deny"
    | "allow_once"
    | "allow_session"
    | "deny_once"
    | "deny_session"
    | "non_interactive_deny";
}

export class PermissionManager {
  readonly #session: CliSessionState;
  readonly #approvalMode: ApprovalMode;
  readonly #interactive: boolean;
  readonly #promptForPermission: PermissionPromptHandler;

  constructor(options: {
    session: CliSessionState;
    approvalMode: ApprovalMode;
    interactive: boolean;
    promptForPermission?: PermissionPromptHandler;
  }) {
    this.#session = options.session;
    this.#approvalMode = options.approvalMode;
    this.#interactive = options.interactive;
    this.#promptForPermission = options.promptForPermission ?? promptForPermission;
  }

  get records(): PermissionRecord[] {
    return this.#session.approvals;
  }

  async request(
    toolName: string,
    args: unknown,
    options?: { signal?: AbortSignal },
  ): Promise<PermissionDecision> {
    const scope = resolvePermissionScope(toolName, args, {
      projectRoot: this.#session.projectRoot,
      defaultCwd: this.#session.cwd,
    });

    if (scope.riskLevel === "safe") {
      return {
        allowed: true,
        riskLevel: scope.riskLevel,
        reason: scope.reason,
        target: scope.target,
        scope: scope.summary,
        outcome: "safe_allow",
      };
    }

    if (this.#approvalMode === "auto" && scope.riskLevel === "moderate") {
      return {
        allowed: true,
        riskLevel: scope.riskLevel,
        reason: scope.reason,
        target: scope.target,
        scope: scope.summary,
        outcome: "auto_allow",
      };
    }

    const existing = this.#session.approvals.find((record) =>
      matchesPermissionRecord(record, scope, args),
    );
    if (existing) {
      return {
        allowed: existing.decision === "allow",
        remembered: true,
        riskLevel: scope.riskLevel,
        reason: scope.reason,
        target: scope.target,
        scope: scope.summary,
        outcome: existing.decision === "allow" ? "remembered_allow" : "remembered_deny",
      };
    }

    if (this.#approvalMode === "never" || !this.#interactive) {
      return {
        allowed: false,
        riskLevel: scope.riskLevel,
        reason: scope.reason,
        target: scope.target,
        scope: scope.summary,
        outcome: "non_interactive_deny",
      };
    }

    const result = await this.#promptForPermission(
      {
      toolName,
      riskLevel: scope.riskLevel,
      reason: scope.reason,
      target: scope.target,
      scope: scope.summary,
      canRememberAllow: scope.canRememberAllow,
      canRememberDeny: scope.canRememberDeny,
      },
      options?.signal,
    );

    if (result.outcome === "allow_session" && scope.canRememberAllow) {
      this.#session.approvals.push(createPermissionRecord(scope, "allow"));
      return {
        allowed: true,
        remembered: true,
        riskLevel: scope.riskLevel,
        reason: scope.reason,
        target: scope.target,
        scope: scope.summary,
        outcome: "allow_session",
      };
    }

    if (result.outcome === "deny_session" && scope.canRememberDeny) {
      this.#session.approvals.push(createPermissionRecord(scope, "deny"));
      return {
        allowed: false,
        remembered: true,
        riskLevel: scope.riskLevel,
        reason: scope.reason,
        target: scope.target,
        scope: scope.summary,
        outcome: "deny_session",
      };
    }

    return {
      allowed: result.outcome === "allow_once",
      riskLevel: scope.riskLevel,
      reason: scope.reason,
      target: scope.target,
      scope: scope.summary,
      outcome: result.outcome === "allow_once" ? "allow_once" : "deny_once",
    };
  }
}
