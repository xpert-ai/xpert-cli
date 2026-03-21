import type { RiskLevel } from "./permissions.js";

export type ToolName =
  | "Read"
  | "Glob"
  | "Grep"
  | "Patch"
  | "Bash"
  | "GitStatus"
  | "GitDiff";

export interface ToolSchemaDescriptor {
  name: ToolName;
  description: string;
  riskLevel: RiskLevel;
  schema: Record<string, unknown>;
}

export interface ToolCallSummary {
  id: string;
  toolName: ToolName;
  summary: string;
  status: "success" | "error" | "denied";
  createdAt: string;
}

export interface ClientToolContextDescriptor {
  name: ToolName;
  description: string;
  schema: Record<string, unknown>;
}
