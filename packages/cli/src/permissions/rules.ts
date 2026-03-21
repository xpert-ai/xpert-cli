import type { RiskLevel } from "@xpert-cli/contracts";
import { detectDangerousCommand } from "./danger-patterns.js";

export function resolveRiskLevel(toolName: string, args: unknown): {
  riskLevel: RiskLevel;
  reason?: string;
  target?: string;
} {
  switch (toolName) {
    case "Read":
    case "Glob":
    case "Grep":
    case "GitStatus":
    case "GitDiff":
      return { riskLevel: "safe" };
    case "Patch":
      return {
        riskLevel: "moderate",
        target: stringifyTarget(args),
      };
    case "Bash": {
      const command =
        typeof args === "object" &&
        args !== null &&
        "command" in args &&
        typeof (args as { command?: unknown }).command === "string"
          ? (args as { command: string }).command
          : "";
      const reason = detectDangerousCommand(command);
      if (reason) {
        return {
          riskLevel: "dangerous",
          reason,
          target: command,
        };
      }
      return {
        riskLevel: "moderate",
        target: command,
      };
    }
    default:
      return { riskLevel: "moderate" };
  }
}

export function buildPermissionKey(toolName: string, args: unknown): string {
  return `${toolName}:${JSON.stringify(args)}`;
}

function stringifyTarget(args: unknown): string | undefined {
  if (!args || typeof args !== "object") {
    return undefined;
  }

  for (const key of ["path", "cwd", "command"]) {
    const value = (args as Record<string, unknown>)[key];
    if (typeof value === "string" && value.trim()) {
      return value;
    }
  }

  return undefined;
}
