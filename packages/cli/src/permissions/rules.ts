import path from "node:path";
import type { PermissionRecord, RiskLevel } from "@xpert-cli/contracts";
import { detectDangerousCommand } from "./danger-patterns.js";

export interface PermissionScope {
  toolName: string;
  riskLevel: RiskLevel;
  reason?: string;
  target?: string;
  scopeType: PermissionRecord["scopeType"];
  path?: string;
  cwd?: string;
  command?: string;
  summary: string;
  canRememberAllow: boolean;
  canRememberDeny: boolean;
}

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
    case "Write":
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

export function resolvePermissionScope(
  toolName: string,
  args: unknown,
  options?: {
    projectRoot?: string;
    defaultCwd?: string;
  },
): PermissionScope {
  const { riskLevel, reason } = resolveRiskLevel(toolName, args);

  switch (toolName) {
    case "Write":
    case "Patch": {
      const filePath = normalizePermissionPath(readStringField(args, "path")) ?? "(unknown path)";
      return {
        toolName,
        riskLevel,
        reason,
        target: filePath,
        scopeType: "path",
        path: filePath,
        summary: `${toolName} ${filePath}`,
        canRememberAllow: true,
        canRememberDeny: true,
      };
    }
    case "Bash": {
      const command = normalizeCommand(readStringField(args, "command")) ?? "(unknown command)";
      const cwd = normalizePermissionPath(
        readStringField(args, "cwd") ?? options?.defaultCwd,
        options?.projectRoot,
      ) ?? ".";
      return {
        toolName,
        riskLevel,
        reason,
        target: command,
        scopeType: "command",
        cwd,
        command,
        summary: `${toolName} ${command} @ ${cwd}`,
        canRememberAllow: riskLevel !== "dangerous",
        canRememberDeny: true,
      };
    }
    default:
      return {
        toolName,
        riskLevel,
        reason,
        target: stringifyTarget(args),
        scopeType: "tool",
        summary: toolName,
        canRememberAllow: riskLevel === "moderate",
        canRememberDeny: true,
      };
  }
}

export function matchesPermissionRecord(
  record: PermissionRecord,
  scope: PermissionScope,
  rawArgs: unknown,
): boolean {
  if (record.toolName !== scope.toolName) {
    return false;
  }

  switch (record.scopeType) {
    case "path":
      return scope.scopeType === "path" && record.path === scope.path;
    case "command":
      return (
        scope.scopeType === "command" &&
        record.cwd === scope.cwd &&
        record.command === scope.command
      );
    case "tool":
      return scope.scopeType === "tool";
    case "legacy":
      return matchesLegacyPermissionRecord(record.legacyKey, scope.toolName, rawArgs);
    default:
      return false;
  }
}

export function createPermissionRecord(
  scope: PermissionScope,
  decision: PermissionRecord["decision"],
): PermissionRecord {
  return {
    toolName: scope.toolName,
    decision,
    riskLevel: scope.riskLevel,
    scopeType: scope.scopeType,
    ...(scope.path ? { path: scope.path } : {}),
    ...(scope.cwd ? { cwd: scope.cwd } : {}),
    ...(scope.command ? { command: scope.command } : {}),
    ...(scope.target ? { target: scope.target } : {}),
    createdAt: new Date().toISOString(),
  };
}

export function buildLegacyPermissionKey(toolName: string, args: unknown): string {
  return `${toolName}:${stringifyLegacyArgs(args)}`;
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

function readStringField(args: unknown, field: string): string | undefined {
  if (!args || typeof args !== "object") {
    return undefined;
  }

  const value = (args as Record<string, unknown>)[field];
  return typeof value === "string" && value.trim() ? value : undefined;
}

function normalizePermissionPath(value: string | undefined, projectRoot?: string): string | undefined {
  if (!value) {
    return undefined;
  }

  if (projectRoot) {
    const root = path.resolve(projectRoot);
    const resolved = path.isAbsolute(value) ? path.resolve(value) : path.resolve(root, value);
    const relative = path.relative(root, resolved);
    if (!relative.startsWith("..") && !path.isAbsolute(relative)) {
      const normalizedRelative = relative.replaceAll(path.sep, "/");
      const cleanedRelative = path.posix.normalize(normalizedRelative).replace(/^\.\//, "");
      return cleanedRelative === "" ? "." : cleanedRelative;
    }
  }

  const normalized = value.replaceAll(path.sep, "/");
  const cleaned = path.posix.normalize(normalized).replace(/^\.\//, "");
  return cleaned === "" ? "." : cleaned;
}

function normalizeCommand(command: string | undefined): string | undefined {
  if (!command) {
    return undefined;
  }

  return command.replace(/\s+/g, " ").trim();
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }

  return `{${Object.entries(value)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`)
    .join(",")}}`;
}

function stringifyLegacyArgs(args: unknown): string {
  try {
    const serialized = JSON.stringify(args);
    return serialized ?? "undefined";
  } catch {
    return String(args);
  }
}

function matchesLegacyPermissionRecord(
  legacyKey: string | undefined,
  toolName: string,
  rawArgs: unknown,
): boolean {
  if (!legacyKey) {
    return false;
  }

  if (legacyKey === buildLegacyPermissionKey(toolName, rawArgs)) {
    return true;
  }

  const legacyArgs = parseLegacyPermissionArgs(legacyKey, toolName);
  if (legacyArgs === undefined) {
    return false;
  }

  return stableStringify(legacyArgs) === stableStringify(rawArgs);
}

function parseLegacyPermissionArgs(key: string, toolName: string): unknown {
  const prefix = `${toolName}:`;
  if (!key.startsWith(prefix)) {
    return undefined;
  }

  try {
    return JSON.parse(key.slice(prefix.length));
  } catch {
    return undefined;
  }
}
