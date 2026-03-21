export type RiskLevel = "safe" | "moderate" | "dangerous";

export interface PermissionRecord {
  key: string;
  decision: "allow" | "deny";
  createdAt: string;
}

export interface PermissionRequest {
  toolName: string;
  riskLevel: RiskLevel;
  reason?: string;
  target?: string;
}
