import { execFile } from "node:child_process";
import path from "node:path";
import type { ResolvedXpertCliConfig, ToolCallSummary } from "@xpert-cli/contracts";
import type { CliSessionState } from "../runtime/session-store.js";
import { loadXpertMd } from "./xpert-md.js";

export const RUN_LOCAL_CONTEXT_LIMITS = {
  xpertMdChars: 2_400,
  xpertMdLines: 48,
  gitStatusChars: 1_600,
  gitStatusLines: 40,
  recentFiles: 10,
  recentToolCalls: 8,
  toolSummaryChars: 160,
  renderedProjectChars: 320,
  renderedGitChars: 900,
  renderedRecentFilesChars: 420,
  renderedRecentToolCallsChars: 760,
  renderedXpertMdChars: 1_200,
  renderedBodyChars: 4_000,
} as const;

export interface RunLocalContext {
  cwd: string;
  projectRoot: string;
  xpertMd: {
    available: boolean;
    path?: string;
    content?: string;
    truncated: boolean;
  };
  git: {
    available: boolean;
    isRepo: boolean;
    statusShort?: string;
    truncated: boolean;
    reason?: string;
  };
  workingSet: {
    recentFiles: string[];
    recentToolCalls: ToolCallSummary[];
  };
}

export type GitCommandRunner = (params: {
  command: string;
  args: string[];
  cwd: string;
  signal?: AbortSignal;
}) => Promise<{
  stdout: string;
  stderr: string;
}>;

export async function buildRunLocalContext(input: {
  config: Pick<ResolvedXpertCliConfig, "cwd" | "projectRoot">;
  session: Pick<CliSessionState, "cwd" | "projectRoot" | "recentFiles" | "recentToolCalls">;
  signal?: AbortSignal;
  deps?: {
    loadXpertMd?: typeof loadXpertMd;
    getGitStatus?: typeof getGitStatusSnapshot;
  };
}): Promise<RunLocalContext> {
  const cwd = input.session.cwd || input.config.cwd;
  const projectRoot = input.session.projectRoot || input.config.projectRoot;
  const readXpertMd = input.deps?.loadXpertMd ?? loadXpertMd;
  const getGitStatus = input.deps?.getGitStatus ?? getGitStatusSnapshot;

  const [xpertMdSource, git] = await Promise.all([
    readXpertMd(projectRoot),
    getGitStatus({
      projectRoot,
      signal: input.signal,
    }),
  ]);

  const xpertMd = truncateXpertMd(xpertMdSource);

  return {
    cwd,
    projectRoot,
    xpertMd,
    git,
    workingSet: {
      recentFiles: input.session.recentFiles
        .slice(0, RUN_LOCAL_CONTEXT_LIMITS.recentFiles)
        .map((filePath) => truncateInline(filePath, RUN_LOCAL_CONTEXT_LIMITS.toolSummaryChars)),
      recentToolCalls: input.session.recentToolCalls
        .slice(0, RUN_LOCAL_CONTEXT_LIMITS.recentToolCalls)
        .map((entry) => ({
          ...entry,
          summary: truncateInline(entry.summary, RUN_LOCAL_CONTEXT_LIMITS.toolSummaryChars),
        })),
    },
  };
}

export async function getGitStatusSnapshot(input: {
  projectRoot: string;
  signal?: AbortSignal;
  runCommand?: GitCommandRunner;
}): Promise<RunLocalContext["git"]> {
  const runCommand = input.runCommand ?? defaultGitCommandRunner;

  try {
    const { stdout } = await runCommand({
      command: "git",
      args: ["-C", input.projectRoot, "status", "--short"],
      cwd: input.projectRoot,
      signal: input.signal,
    });
    const status = truncateMultiline(
      stdout.trimEnd(),
      RUN_LOCAL_CONTEXT_LIMITS.gitStatusLines,
      RUN_LOCAL_CONTEXT_LIMITS.gitStatusChars,
    );

    return {
      available: true,
      isRepo: true,
      statusShort: status.value,
      truncated: status.truncated,
    };
  } catch (error) {
    if (isAbortError(error, input.signal)) {
      throw error;
    }

    const reason = getCommandFailureReason(error);
    if (reason.kind === "command_missing") {
      return {
        available: false,
        isRepo: false,
        truncated: false,
        reason: "git executable unavailable",
      };
    }

    if (reason.kind === "not_repo") {
      return {
        available: true,
        isRepo: false,
        truncated: false,
        reason: "not a git repository",
      };
    }

    return {
      available: true,
      isRepo: false,
      truncated: false,
      reason: truncateInline(`git status failed: ${reason.message}`, RUN_LOCAL_CONTEXT_LIMITS.toolSummaryChars),
    };
  }
}

export function renderLocalContextBlock(localContext: RunLocalContext): string {
  const sections = [
    {
      text: [
        `Project root: ${localContext.projectRoot}`,
        `Current cwd: ${localContext.cwd}`,
      ].join("\n"),
      maxChars: RUN_LOCAL_CONTEXT_LIMITS.renderedProjectChars,
    },
    {
      text: renderGitSection(localContext).join("\n"),
      maxChars: RUN_LOCAL_CONTEXT_LIMITS.renderedGitChars,
    },
    {
      text: renderRecentFilesSection(localContext).join("\n"),
      maxChars: RUN_LOCAL_CONTEXT_LIMITS.renderedRecentFilesChars,
    },
    {
      text: renderRecentToolCallsSection(localContext).join("\n"),
      maxChars: RUN_LOCAL_CONTEXT_LIMITS.renderedRecentToolCallsChars,
    },
    {
      text: renderXpertMdSection(localContext).join("\n"),
      maxChars: RUN_LOCAL_CONTEXT_LIMITS.renderedXpertMdChars,
    },
  ];

  const body = renderBoundedContextSections(
    sections,
    RUN_LOCAL_CONTEXT_LIMITS.renderedBodyChars,
  );

  return [
    "[Local Context]",
    body.value,
    ...(body.truncated ? ["", "Note: local context was truncated."] : []),
    "[/Local Context]",
  ].join("\n");
}

export function renderPromptWithLocalContext(
  prompt: string,
  localContext: RunLocalContext,
): string {
  return [
    renderLocalContextBlock(localContext),
    "",
    "User request:",
    prompt,
  ].join("\n");
}

function renderGitSection(localContext: RunLocalContext): string[] {
  if (!localContext.git.available) {
    return [`Git status (--short): unavailable (${localContext.git.reason ?? "git unavailable"})`];
  }

  if (!localContext.git.isRepo) {
    return [`Git status (--short): unavailable (${localContext.git.reason ?? "not a git repository"})`];
  }

  return [
    "Git status (--short):",
    ...indentBlock(
      localContext.git.statusShort || "(clean working tree)",
      localContext.git.truncated,
    ),
  ];
}

function renderXpertMdSection(localContext: RunLocalContext): string[] {
  if (!localContext.xpertMd.available) {
    return ["XPERT.md: not found"];
  }

  return [
    `XPERT.md (${localContext.xpertMd.path}):`,
    ...indentBlock(localContext.xpertMd.content || "(empty file)", localContext.xpertMd.truncated),
  ];
}

function renderRecentFilesSection(localContext: RunLocalContext): string[] {
  if (localContext.workingSet.recentFiles.length === 0) {
    return ["Recent changed files: none"];
  }

  return [
    "Recent changed files:",
    ...localContext.workingSet.recentFiles.map((filePath) => `  - ${renderPath(filePath, localContext.projectRoot)}`),
  ];
}

function renderRecentToolCallsSection(localContext: RunLocalContext): string[] {
  if (localContext.workingSet.recentToolCalls.length === 0) {
    return ["Recent tool calls: none"];
  }

  return [
    "Recent tool calls:",
    ...localContext.workingSet.recentToolCalls.map(
      (entry) => `  - ${entry.toolName} [${entry.status}]: ${entry.summary}`,
    ),
  ];
}

function indentBlock(text: string, truncated: boolean): string[] {
  return [
    ...text.split("\n").map((line) => `  ${line}`),
    ...(truncated ? ["  ...(truncated)"] : []),
  ];
}

function truncateXpertMd(input: { path?: string; content?: string }): RunLocalContext["xpertMd"] {
  if (!input.path) {
    return {
      available: false,
      truncated: false,
    };
  }

  const content = truncateMultiline(
    (input.content ?? "").trim(),
    RUN_LOCAL_CONTEXT_LIMITS.xpertMdLines,
    RUN_LOCAL_CONTEXT_LIMITS.xpertMdChars,
  );

  return {
    available: true,
    path: input.path,
    content: content.value,
    truncated: content.truncated,
  };
}

function renderPath(filePath: string, projectRoot: string): string {
  if (!path.isAbsolute(filePath)) {
    return filePath;
  }

  const relativePath = path.relative(projectRoot, filePath);
  return relativePath.startsWith("..") ? filePath : relativePath;
}

function truncateMultiline(
  text: string,
  maxLines: number,
  maxChars: number,
): { value: string; truncated: boolean } {
  const normalized = text.trim();
  if (!normalized) {
    return { value: "", truncated: false };
  }

  const lines = normalized.split(/\r?\n/);
  let truncated = false;
  let limitedLines = lines;
  if (lines.length > maxLines) {
    limitedLines = lines.slice(0, maxLines);
    truncated = true;
  }

  const limitedText = limitedLines.join("\n");
  const charLimited = truncateInlineSections(limitedText, maxChars);

  return {
    value: charLimited.value,
    truncated: truncated || charLimited.truncated,
  };
}

function truncateInline(text: string, maxChars: number): string {
  return truncateInlineSections(text, maxChars).value;
}

function truncateInlineSections(
  text: string,
  maxChars: number,
): { value: string; truncated: boolean } {
  if (text.length <= maxChars) {
    return { value: text, truncated: false };
  }

  if (maxChars <= 3) {
    return { value: text.slice(0, maxChars), truncated: true };
  }

  return {
    value: `${text.slice(0, maxChars - 3)}...`,
    truncated: true,
  };
}

function renderBoundedContextSections(
  sections: Array<{ text: string; maxChars: number }>,
  maxChars: number,
): { value: string; truncated: boolean } {
  const renderedSections: string[] = [];
  let remaining = maxChars;
  let truncated = false;

  for (const section of sections) {
    const text = section.text.trim();
    if (!text) {
      continue;
    }

    const separatorChars = renderedSections.length > 0 ? 2 : 0;
    if (remaining <= separatorChars) {
      truncated = true;
      break;
    }

    const sectionBudget = Math.min(section.maxChars, remaining - separatorChars);
    const limited = truncateInlineSections(text, sectionBudget);
    if (!limited.value.trim()) {
      truncated = truncated || limited.truncated;
      continue;
    }

    renderedSections.push(limited.value);
    remaining -= separatorChars + limited.value.length;
    truncated = truncated || limited.truncated;
  }

  return {
    value: renderedSections.join("\n\n"),
    truncated,
  };
}

async function defaultGitCommandRunner(params: {
  command: string;
  args: string[];
  cwd: string;
  signal?: AbortSignal;
}): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(
      params.command,
      params.args,
      {
        cwd: params.cwd,
        encoding: "utf8",
        maxBuffer: 64 * 1024,
        signal: params.signal,
      },
      (error, stdout, stderr) => {
        if (error) {
          const enriched = error as ExecFileError;
          enriched.stdout = stdout;
          enriched.stderr = stderr;
          reject(enriched);
          return;
        }

        resolve({ stdout, stderr });
      },
    );
  });
}

function isAbortError(error: unknown, signal?: AbortSignal): boolean {
  return Boolean(signal?.aborted) || (error instanceof Error && error.name === "AbortError");
}

function getCommandFailureReason(error: unknown): {
  kind: "command_missing" | "not_repo" | "failed";
  message: string;
} {
  const execError = error as ExecFileError | undefined;

  if (execError?.code === "ENOENT") {
    return {
      kind: "command_missing",
      message: execError.message,
    };
  }

  const detail = [execError?.stderr, execError?.stdout, execError?.message]
    .find((value) => typeof value === "string" && value.trim()) ?? "unknown git failure";

  if (/not a git repository/i.test(detail)) {
    return {
      kind: "not_repo",
      message: detail,
    };
  }

  return {
    kind: "failed",
    message: detail.trim(),
  };
}

interface ExecFileError extends Error {
  code?: string | number;
  stdout?: string;
  stderr?: string;
}
