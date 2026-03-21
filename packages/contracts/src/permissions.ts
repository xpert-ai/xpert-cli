export type RiskLevel = "safe" | "moderate" | "dangerous";

export type PermissionScopeType = "path" | "command" | "tool" | "legacy";

export interface PermissionRecord {
  toolName: string;
  decision: "allow" | "deny";
  riskLevel: RiskLevel;
  scopeType: PermissionScopeType;
  path?: string;
  cwd?: string;
  command?: string;
  target?: string;
  legacyKey?: string;
  createdAt: string;
}

export interface PermissionRequest {
  toolName: string;
  riskLevel: RiskLevel;
  reason?: string;
  target?: string;
  scope?: string;
  canRememberAllow?: boolean;
  canRememberDeny?: boolean;
}
