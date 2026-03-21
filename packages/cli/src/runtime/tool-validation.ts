import path from "node:path";
import type { ToolName } from "@xpert-cli/contracts";
import { resolveWorkspacePath } from "../tools/backends/host.js";
import type {
  PatchEdit,
  PatchFileArgs,
  ToolExecutionResult,
  WriteFileArgs,
} from "../tools/contracts.js";

export const INVALID_TOOL_PAYLOAD = "INVALID_TOOL_PAYLOAD";

export interface ToolValidationIssue {
  field: string;
  expected: string;
  actual: string;
}

export type ToolValidationResult<T = unknown> =
  | { ok: true; value: T }
  | {
      ok: false;
      error: {
        code: typeof INVALID_TOOL_PAYLOAD;
        toolName: string;
        message: string;
        issues: ToolValidationIssue[];
        receivedArgsSummary: string;
      };
    };

export function validateToolPayload(
  toolName: string,
  args: unknown,
  options: { projectRoot: string },
): ToolValidationResult {
  switch (toolName) {
    case "Read":
      return validateReadArgs(args, options);
    case "Glob":
      return validateGlobArgs(args, options);
    case "Grep":
      return validateGrepArgs(args, options);
    case "Write":
      return validateWriteArgs(args, options);
    case "Patch":
      return validatePatchArgs(args, options);
    case "Bash":
      return validateBashArgs(args, options);
    case "GitStatus":
      return validateGitStatusArgs(args, options);
    case "GitDiff":
      return validateGitDiffArgs(args, options);
    default:
      return {
        ok: true,
        value: args,
      };
  }
}

export function toInvalidToolPayloadResult(
  error: Extract<ToolValidationResult, { ok: false }>["error"],
): ToolExecutionResult {
  return {
    summary: error.message,
    content: error.message,
    artifact: {
      code: error.code,
      toolName: error.toolName,
      issues: error.issues,
      receivedArgsSummary: error.receivedArgsSummary,
    },
  };
}

function validateReadArgs(
  args: unknown,
  options: { projectRoot: string },
): ToolValidationResult<{
  path: string;
  offset?: number;
  limit?: number;
}> {
  const issues: ToolValidationIssue[] = [];
  const record = expectRecord(args, issues, "args");
  if (!record) {
    return buildFailure("Read", args, issues);
  }

  const filePath = readWorkspacePath(record.path, "path", issues, options.projectRoot, "read");
  const offset = readPositiveInteger(record.offset, "offset", issues);
  const limit = readPositiveInteger(record.limit, "limit", issues);

  if (issues.length > 0 || !filePath) {
    return buildFailure("Read", args, issues);
  }

  return {
    ok: true,
    value: {
      path: filePath,
      ...(offset !== undefined ? { offset } : {}),
      ...(limit !== undefined ? { limit } : {}),
    },
  };
}

function validateGlobArgs(
  args: unknown,
  options: { projectRoot: string },
): ToolValidationResult<{
  pattern: string;
  searchPath?: string;
}> {
  const issues: ToolValidationIssue[] = [];
  const record = expectRecord(args, issues, "args");
  if (!record) {
    return buildFailure("Glob", args, issues);
  }

  const pattern = readNonEmptyString(record.pattern, "pattern", issues);
  const searchPath = readWorkspacePath(
    record.searchPath,
    "searchPath",
    issues,
    options.projectRoot,
    "read",
    true,
  );

  if (issues.length > 0 || !pattern) {
    return buildFailure("Glob", args, issues);
  }

  return {
    ok: true,
    value: {
      pattern,
      ...(searchPath !== undefined ? { searchPath } : {}),
    },
  };
}

function validateGrepArgs(
  args: unknown,
  options: { projectRoot: string },
): ToolValidationResult<{
  pattern: string;
  searchPath?: string;
  glob?: string;
}> {
  const issues: ToolValidationIssue[] = [];
  const record = expectRecord(args, issues, "args");
  if (!record) {
    return buildFailure("Grep", args, issues);
  }

  const pattern = readNonEmptyString(record.pattern, "pattern", issues);
  const searchPath = readWorkspacePath(
    record.searchPath,
    "searchPath",
    issues,
    options.projectRoot,
    "read",
    true,
  );
  const glob = readOptionalNonEmptyString(record.glob, "glob", issues);

  if (issues.length > 0 || !pattern) {
    return buildFailure("Grep", args, issues);
  }

  return {
    ok: true,
    value: {
      pattern,
      ...(searchPath !== undefined ? { searchPath } : {}),
      ...(glob !== undefined ? { glob } : {}),
    },
  };
}

function validateWriteArgs(
  args: unknown,
  options: { projectRoot: string },
): ToolValidationResult<WriteFileArgs> {
  const issues: ToolValidationIssue[] = [];
  const record = expectRecord(args, issues, "args");
  if (!record) {
    return buildFailure("Write", args, issues);
  }

  const filePath = readWorkspacePath(record.path, "path", issues, options.projectRoot, "write");
  const content = readString(record.content, "content", issues);

  if (issues.length > 0 || !filePath || content === undefined) {
    return buildFailure("Write", args, issues);
  }

  return {
    ok: true,
    value: {
      path: filePath,
      content,
    },
  };
}

function validatePatchArgs(
  args: unknown,
  options: { projectRoot: string },
): ToolValidationResult<PatchFileArgs> {
  const issues: ToolValidationIssue[] = [];
  const record = expectRecord(args, issues, "args");
  if (!record) {
    return buildFailure("Patch", args, issues);
  }

  const filePath = readWorkspacePath(record.path, "path", issues, options.projectRoot, "write");
  const kind = readOptionalKind(record.kind, "kind", issues, ["replace", "range", "multi"]);

  if (!filePath || issues.length > 0) {
    return buildFailure("Patch", args, issues);
  }

  if (kind === "multi") {
    const edits = validatePatchEdits(record.edits, issues);
    if (issues.length > 0 || !edits) {
      return buildFailure("Patch", args, issues);
    }

    return {
      ok: true,
      value: {
        kind: "multi",
        path: filePath,
        edits,
      },
    };
  }

  if (kind === "range") {
    const startLine = readPositiveInteger(record.startLine, "startLine", issues);
    const endLine = readPositiveInteger(record.endLine, "endLine", issues);
    const newContent = readString(record.newContent, "newContent", issues);

    if (
      startLine !== undefined &&
      endLine !== undefined &&
      endLine < startLine
    ) {
      issues.push({
        field: "endLine",
        expected: "an integer greater than or equal to startLine",
        actual: String(endLine),
      });
    }

    if (issues.length > 0 || startLine === undefined || endLine === undefined || newContent === undefined) {
      return buildFailure("Patch", args, issues);
    }

    return {
      ok: true,
      value: {
        kind: "range",
        path: filePath,
        startLine,
        endLine,
        newContent,
      },
    };
  }

  const oldString = readString(record.oldString, "oldString", issues);
  const newString = readString(record.newString, "newString", issues);
  const replaceAll = readOptionalBoolean(record.replaceAll, "replaceAll", issues);

  if (oldString !== undefined && oldString.length === 0) {
    issues.push({
      field: "oldString",
      expected: "a non-empty string",
      actual: '""',
    });
  }

  if (issues.length > 0 || oldString === undefined || newString === undefined) {
    return buildFailure("Patch", args, issues);
  }

  return {
    ok: true,
    value: {
      path: filePath,
      oldString,
      newString,
      ...(replaceAll !== undefined ? { replaceAll } : {}),
    },
  };
}

function validatePatchEdits(
  value: unknown,
  issues: ToolValidationIssue[],
): PatchEdit[] | undefined {
  if (!Array.isArray(value)) {
    issues.push({
      field: "edits",
      expected: "a non-empty array of patch edits",
      actual: describeValue(value),
    });
    return undefined;
  }

  if (value.length === 0) {
    issues.push({
      field: "edits",
      expected: "a non-empty array of patch edits",
      actual: "an empty array",
    });
    return undefined;
  }

  const edits: PatchEdit[] = [];

  for (const [index, item] of value.entries()) {
    const fieldPrefix = `edits[${index}]`;
    const record = expectRecord(item, issues, fieldPrefix);
    if (!record) {
      continue;
    }

    const kind = readOptionalKind(record.kind, `${fieldPrefix}.kind`, issues, ["replace", "range"]);
    if (kind === "range") {
      const startLine = readPositiveInteger(record.startLine, `${fieldPrefix}.startLine`, issues);
      const endLine = readPositiveInteger(record.endLine, `${fieldPrefix}.endLine`, issues);
      const newContent = readString(record.newContent, `${fieldPrefix}.newContent`, issues);

      if (
        startLine !== undefined &&
        endLine !== undefined &&
        endLine < startLine
      ) {
        issues.push({
          field: `${fieldPrefix}.endLine`,
          expected: "an integer greater than or equal to startLine",
          actual: String(endLine),
        });
      }

      if (startLine !== undefined && endLine !== undefined && newContent !== undefined) {
        edits.push({
          kind: "range",
          startLine,
          endLine,
          newContent,
        });
      }
      continue;
    }

    const oldString = readString(record.oldString, `${fieldPrefix}.oldString`, issues);
    const newString = readString(record.newString, `${fieldPrefix}.newString`, issues);
    const replaceAll = readOptionalBoolean(record.replaceAll, `${fieldPrefix}.replaceAll`, issues);

    if (oldString !== undefined && oldString.length === 0) {
      issues.push({
        field: `${fieldPrefix}.oldString`,
        expected: "a non-empty string",
        actual: '""',
      });
    }

    if (oldString !== undefined && newString !== undefined && oldString.length > 0) {
      edits.push({
        oldString,
        newString,
        ...(replaceAll !== undefined ? { replaceAll } : {}),
      });
    }
  }

  return edits;
}

function validateBashArgs(
  args: unknown,
  options: { projectRoot: string },
): ToolValidationResult<{
  command: string;
  cwd?: string;
  timeoutMs?: number;
}> {
  const issues: ToolValidationIssue[] = [];
  const record = expectRecord(args, issues, "args");
  if (!record) {
    return buildFailure("Bash", args, issues);
  }

  const command = readNonEmptyString(record.command, "command", issues);
  const cwd = readWorkspacePath(record.cwd, "cwd", issues, options.projectRoot, "read", true);
  const timeoutMs = readPositiveNumber(record.timeoutMs, "timeoutMs", issues);

  if (issues.length > 0 || !command) {
    return buildFailure("Bash", args, issues);
  }

  return {
    ok: true,
    value: {
      command,
      ...(cwd !== undefined ? { cwd } : {}),
      ...(timeoutMs !== undefined ? { timeoutMs } : {}),
    },
  };
}

function validateGitStatusArgs(
  args: unknown,
  options: { projectRoot: string },
): ToolValidationResult<{ cwd?: string }> {
  const issues: ToolValidationIssue[] = [];
  const record = optionalRecord(args, issues, "args");
  if (issues.length > 0) {
    return buildFailure("GitStatus", args, issues);
  }

  const cwd = readWorkspacePath(
    record?.cwd,
    "cwd",
    issues,
    options.projectRoot,
    "read",
    true,
  );

  if (issues.length > 0) {
    return buildFailure("GitStatus", args, issues);
  }

  return {
    ok: true,
    value: cwd ? { cwd } : {},
  };
}

function validateGitDiffArgs(
  args: unknown,
  options: { projectRoot: string },
): ToolValidationResult<{ path?: string; staged?: boolean; cwd?: string }> {
  const issues: ToolValidationIssue[] = [];
  const record = optionalRecord(args, issues, "args");
  if (issues.length > 0) {
    return buildFailure("GitDiff", args, issues);
  }

  const filePath = readWorkspacePath(
    record?.path,
    "path",
    issues,
    options.projectRoot,
    "read",
    true,
  );
  const staged = readOptionalBoolean(record?.staged, "staged", issues);
  const cwd = readWorkspacePath(
    record?.cwd,
    "cwd",
    issues,
    options.projectRoot,
    "read",
    true,
  );

  if (issues.length > 0) {
    return buildFailure("GitDiff", args, issues);
  }

  return {
    ok: true,
    value: {
      ...(filePath !== undefined ? { path: filePath } : {}),
      ...(staged !== undefined ? { staged } : {}),
      ...(cwd !== undefined ? { cwd } : {}),
    },
  };
}

function expectRecord(
  value: unknown,
  issues: ToolValidationIssue[],
  field: string,
): Record<string, unknown> | undefined {
  if (!isRecord(value)) {
    issues.push({
      field,
      expected: "an object",
      actual: describeValue(value),
    });
    return undefined;
  }

  return value;
}

function optionalRecord(
  value: unknown,
  issues: ToolValidationIssue[],
  field: string,
): Record<string, unknown> | undefined {
  if (value === undefined || value === null) {
    return {};
  }

  return expectRecord(value, issues, field);
}

function readWorkspacePath(
  value: unknown,
  field: string,
  issues: ToolValidationIssue[],
  projectRoot: string,
  mode: "read" | "write",
  optional = false,
): string | undefined {
  if (value === undefined) {
    if (optional) {
      return undefined;
    }
    issues.push({
      field,
      expected: "a path inside the project root",
      actual: "missing",
    });
    return undefined;
  }

  if (typeof value !== "string" || value.trim() === "") {
    issues.push({
      field,
      expected: "a non-empty string path inside the project root",
      actual: describeValue(value),
    });
    return undefined;
  }

  try {
    const absolutePath = resolveWorkspacePath(projectRoot, value, mode);
    return normalizeRelativePath(path.relative(path.resolve(projectRoot), absolutePath));
  } catch (error) {
    issues.push({
      field,
      expected: mode === "write" ? "a writable path inside the project root" : "a path inside the project root",
      actual: JSON.stringify(value),
    });
    if (error instanceof Error && error.message) {
      issues.push({
        field: `${field}._detail`,
        expected: "a valid workspace path",
        actual: error.message,
      });
    }
    return undefined;
  }
}

function readString(
  value: unknown,
  field: string,
  issues: ToolValidationIssue[],
): string | undefined {
  if (typeof value !== "string") {
    issues.push({
      field,
      expected: "a string",
      actual: describeValue(value),
    });
    return undefined;
  }

  return value;
}

function readNonEmptyString(
  value: unknown,
  field: string,
  issues: ToolValidationIssue[],
): string | undefined {
  if (typeof value !== "string" || value.trim() === "") {
    issues.push({
      field,
      expected: "a non-empty string",
      actual: describeValue(value),
    });
    return undefined;
  }

  return value;
}

function readOptionalNonEmptyString(
  value: unknown,
  field: string,
  issues: ToolValidationIssue[],
): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  return readNonEmptyString(value, field, issues);
}

function readPositiveInteger(
  value: unknown,
  field: string,
  issues: ToolValidationIssue[],
): number | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
    issues.push({
      field,
      expected: "a positive integer",
      actual: describeValue(value),
    });
    return undefined;
  }

  return value;
}

function readPositiveNumber(
  value: unknown,
  field: string,
  issues: ToolValidationIssue[],
): number | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== "number" || !Number.isFinite(value) || value < 1) {
    issues.push({
      field,
      expected: "a positive number",
      actual: describeValue(value),
    });
    return undefined;
  }

  return value;
}

function readOptionalBoolean(
  value: unknown,
  field: string,
  issues: ToolValidationIssue[],
): boolean | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== "boolean") {
    issues.push({
      field,
      expected: "a boolean",
      actual: describeValue(value),
    });
    return undefined;
  }

  return value;
}

function readOptionalKind<TKind extends string>(
  value: unknown,
  field: string,
  issues: ToolValidationIssue[],
  allowed: TKind[],
): TKind | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== "string" || !allowed.includes(value as TKind)) {
    issues.push({
      field,
      expected: `one of ${allowed.join(", ")}`,
      actual: describeValue(value),
    });
    return undefined;
  }

  return value as TKind;
}

function buildFailure(
  toolName: ToolName | string,
  args: unknown,
  issues: ToolValidationIssue[],
): Extract<ToolValidationResult, { ok: false }> {
  const primaryIssue = issues[0];
  const message =
    primaryIssue == null
      ? `Invalid arguments for ${toolName}.`
      : `Invalid arguments for ${toolName}: ${primaryIssue.field} expected ${primaryIssue.expected}, got ${primaryIssue.actual}.`;

  return {
    ok: false,
    error: {
      code: INVALID_TOOL_PAYLOAD,
      toolName,
      message,
      issues,
      receivedArgsSummary: clipInline(stableStringify(args), 240),
    },
  };
}

function normalizeRelativePath(value: string): string {
  const normalized = value.replaceAll(path.sep, "/");
  const cleaned = path.posix.normalize(normalized);
  return cleaned === "." ? "" : cleaned.replace(/^\.\//, "");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function describeValue(value: unknown): string {
  if (value === undefined) {
    return "undefined";
  }
  if (value === null) {
    return "null";
  }
  if (typeof value === "string") {
    return JSON.stringify(value);
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (Array.isArray(value)) {
    return "an array";
  }
  return typeof value;
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

function clipInline(value: string, maxChars: number): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxChars) {
    return normalized;
  }

  const marker = " ...[truncated]... ";
  const head = Math.max(0, Math.floor((maxChars - marker.length) * 0.7));
  const tail = Math.max(0, maxChars - marker.length - head);
  return `${normalized.slice(0, head)}${marker}${normalized.slice(-tail)}`;
}
