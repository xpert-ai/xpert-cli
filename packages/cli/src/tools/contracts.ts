import type { ClientToolContextDescriptor, ToolName } from "@xpert-cli/contracts";
import type { PermissionManager } from "../permissions/manager.js";
import type { CliSessionState } from "../runtime/session-store.js";
import type { UiRenderer } from "../ui/renderer.js";

export interface ExecutionBackend {
  mode: "host" | "docker" | "remote-sandbox";
  readFile(
    filePath: string,
    opts?: { offset?: number; limit?: number },
  ): Promise<string>;
  glob(pattern: string, searchPath?: string): Promise<string[]>;
  grep(pattern: string, searchPath?: string, glob?: string): Promise<string>;
  patchFile(args: {
    path: string;
    oldString: string;
    newString: string;
    replaceAll?: boolean;
  }): Promise<{ path: string; diff: string; occurrences: number }>;
  exec(
    command: string,
    opts?: {
      cwd?: string;
      timeoutMs?: number;
      onLine?: (line: string) => void;
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
