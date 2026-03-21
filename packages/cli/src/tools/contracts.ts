import type { ClientToolContextDescriptor, ToolName } from "@xpert-cli/contracts";
import type { PermissionManager } from "../permissions/manager.js";
import type { CliSessionState } from "../runtime/session-store.js";
import type { UiRenderer } from "../ui/renderer.js";

export interface WriteFileArgs {
  path: string;
  content: string;
}

export interface WriteFileResult {
  path: string;
  diff: string;
}

export interface PatchReplaceEdit {
  kind?: "replace";
  oldString: string;
  newString: string;
  replaceAll?: boolean;
}

export interface PatchRangeEdit {
  kind: "range";
  startLine: number;
  endLine: number;
  newContent: string;
}

export type PatchEdit = PatchReplaceEdit | PatchRangeEdit;

export interface PatchReplaceFileArgs extends PatchReplaceEdit {
  path: string;
}

export interface PatchRangeFileArgs extends PatchRangeEdit {
  path: string;
}

export interface PatchMultiFileArgs {
  kind: "multi";
  path: string;
  edits: PatchEdit[];
}

export type PatchFileArgs =
  | PatchReplaceFileArgs
  | PatchRangeFileArgs
  | PatchMultiFileArgs;

export interface PatchFileResult {
  path: string;
  diff: string;
  mode: "replace" | "range" | "multi";
  occurrences: number;
  appliedEdits: number;
}

export interface ExecutionBackend {
  mode: "host" | "docker" | "remote-sandbox";
  readFile(
    filePath: string,
    opts?: { offset?: number; limit?: number },
  ): Promise<string>;
  glob(pattern: string, searchPath?: string): Promise<string[]>;
  grep(pattern: string, searchPath?: string, glob?: string): Promise<string>;
  writeFile(args: WriteFileArgs): Promise<WriteFileResult>;
  patchFile(args: PatchFileArgs): Promise<PatchFileResult>;
  exec(
    command: string,
    opts?: {
      cwd?: string;
      timeoutMs?: number;
      onLine?: (line: string) => void;
      signal?: AbortSignal;
    },
  ): Promise<{
    exitCode: number | null;
    output: string;
    timedOut?: boolean;
  }>;
}

export interface ToolExecutionContext {
  projectRoot: string;
  cwd: string;
  backend: ExecutionBackend;
  permissions: PermissionManager;
  session: CliSessionState;
  ui: UiRenderer;
  signal?: AbortSignal;
}

export interface ToolExecutionResult {
  summary: string;
  content: unknown;
  artifact?: unknown;
  changedFiles?: string[];
}

export interface ToolDefinition<TArgs = unknown> {
  name: ToolName;
  description: string;
  schema: Record<string, unknown>;
  execute(
    args: TArgs,
    context: ToolExecutionContext,
  ): Promise<ToolExecutionResult>;
}

export interface ToolRegistry {
  tools: Map<string, ToolDefinition>;
  clientTools: ClientToolContextDescriptor[];
}
