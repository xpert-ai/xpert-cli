import { spawn, spawnSync } from "node:child_process";
import {
  mkdir,
  readFile,
  writeFile as fsWriteFile,
} from "node:fs/promises";
import path from "node:path";
import fg from "fast-glob";
import { createUnifiedDiff } from "../../ui/diff.js";
import { createAbortError, throwIfAborted } from "../../runtime/turn-control.js";
import type {
  ExecutionBackend,
  PatchEdit,
  PatchFileArgs,
  PatchFileResult,
  WriteFileArgs,
  WriteFileResult,
} from "../contracts.js";

type NormalizedReplaceEdit = {
  kind: "replace";
  oldString: string;
  newString: string;
  replaceAll: boolean;
};

type NormalizedRangeEdit = {
  kind: "range";
  startLine: number;
  endLine: number;
  newContent: string;
};

type NormalizedPatchEdit = NormalizedReplaceEdit | NormalizedRangeEdit;

type NormalizedPatchFileArgs =
  | ({ kind: "replace"; path: string } & NormalizedReplaceEdit)
  | ({ kind: "range"; path: string } & NormalizedRangeEdit)
  | { kind: "multi"; path: string; edits: NormalizedPatchEdit[] };

export class HostExecutionBackend implements ExecutionBackend {
  readonly mode = "host" as const;
  readonly #projectRoot: string;

  constructor(projectRoot: string) {
    this.#projectRoot = path.resolve(projectRoot);
  }

  async readFile(
    filePath: string,
    opts?: { offset?: number; limit?: number },
  ): Promise<string> {
    const absolutePath = resolveWorkspacePath(this.#projectRoot, filePath, "read");
    const content = await readFile(absolutePath, "utf8");
    const lines = content.split(/\r?\n/);
    const offset = Math.max(1, opts?.offset ?? 1);
    const limit = Math.max(1, opts?.limit ?? 200);
    const slice = lines.slice(offset - 1, offset - 1 + limit);

    if (slice.length === 0) {
      return "";
    }

    return slice
      .map((line, index) => `${offset + index} | ${line}`)
      .join("\n");
  }

  async glob(pattern: string, searchPath?: string): Promise<string[]> {
    const cwd = searchPath
      ? resolveWorkspacePath(this.#projectRoot, searchPath, "read")
      : this.#projectRoot;

    const matches = await fg(pattern, {
      cwd,
      onlyFiles: true,
      dot: true,
      ignore: ["**/node_modules/**", "**/.git/**"],
    });

    return matches
      .map((match) => path.relative(this.#projectRoot, path.resolve(cwd, match)))
      .sort();
  }

  async grep(pattern: string, searchPath?: string, glob?: string): Promise<string> {
    const cwd = searchPath
      ? resolveWorkspacePath(this.#projectRoot, searchPath, "read")
      : this.#projectRoot;

    const rgArgs = [
      "--line-number",
      "--no-heading",
      "--color",
      "never",
      pattern,
      cwd,
    ];
    if (glob) {
      rgArgs.unshift("--glob", glob);
    }

    const result = spawnSync("rg", rgArgs, {
      cwd: this.#projectRoot,
      encoding: "utf8",
    });

    if (result.error) {
      throw result.error;
    }

    if (result.status === 1) {
      return "";
    }

    if (result.status !== 0) {
      throw new Error(result.stderr.trim() || "rg failed");
    }

    return result.stdout
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => line.replace(`${this.#projectRoot}${path.sep}`, ""))
      .join("\n");
  }

  async writeFile(args: WriteFileArgs): Promise<WriteFileResult> {
    const validatedArgs = validateWriteFileArgs(args);
    const absolutePath = resolveWorkspacePath(this.#projectRoot, validatedArgs.path, "write");
    const relativePath = path.relative(this.#projectRoot, absolutePath);

    await mkdir(path.dirname(absolutePath), { recursive: true });

    try {
      await fsWriteFile(absolutePath, validatedArgs.content, {
        encoding: "utf8",
        flag: "wx",
      });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") {
        throw new Error(`File already exists: ${validatedArgs.path}. Use Patch instead.`);
      }
      throw error;
    }

    return {
      path: relativePath,
      diff: createUnifiedDiff(relativePath, "", validatedArgs.content),
    };
  }

  async patchFile(args: PatchFileArgs): Promise<PatchFileResult> {
    const absolutePath = resolveWorkspacePath(this.#projectRoot, args.path, "write");
    const relativePath = path.relative(this.#projectRoot, absolutePath);
    const before = await readFile(absolutePath, "utf8");
    const normalizedArgs = normalizePatchFileArgs(args);
    const nextState = applyPatchFile(before, normalizedArgs, relativePath);

    if (before === nextState.next) {
      throw new Error(`Patch produced no changes for ${relativePath}`);
    }

    await fsWriteFile(absolutePath, nextState.next, "utf8");

    return {
      path: relativePath,
      diff: createUnifiedDiff(relativePath, before, nextState.next),
      mode: nextState.mode,
      occurrences: nextState.occurrences,
      appliedEdits: nextState.appliedEdits,
    };
  }

  async exec(
    command: string,
    opts?: {
      cwd?: string;
      timeoutMs?: number;
      onLine?: (line: string) => void;
      signal?: AbortSignal;
    },
  ): Promise<{ exitCode: number | null; output: string; timedOut?: boolean }> {
    throwIfAborted(opts?.signal);

    const cwd = opts?.cwd
      ? resolveWorkspacePath(this.#projectRoot, opts.cwd, "read")
      : this.#projectRoot;

    const child = spawn(process.env.SHELL || "zsh", ["-lc", command], {
      cwd,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    const chunks: string[] = [];
    let timedOut = false;
    let aborted = false;

    const push = (line: string) => {
      chunks.push(line);
      opts?.onLine?.(line);
    };

    wireStream(child.stdout, push);
    wireStream(child.stderr, push);

    const timeoutMs = opts?.timeoutMs ?? 120_000;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 1000).unref();
    }, timeoutMs);

    const abortChild = () => {
      aborted = true;
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 1000).unref();
    };

    opts?.signal?.addEventListener("abort", abortChild, { once: true });

    const exitCode = await new Promise<number | null>((resolve, reject) => {
      child.on("error", reject);
      child.on("close", (code) => resolve(code));
    }).finally(() => {
      clearTimeout(timer);
      opts?.signal?.removeEventListener("abort", abortChild);
    });

    if (aborted) {
      throw opts?.signal?.reason instanceof Error
        ? opts.signal.reason
        : createAbortError();
    }

    return {
      exitCode,
      output: chunks.join("\n"),
      ...(timedOut ? { timedOut: true } : {}),
    };
  }
}

export function resolveWorkspacePath(
  projectRoot: string,
  inputPath: string,
  mode: "read" | "write",
): string {
  const root = path.resolve(projectRoot);
  const resolved = path.resolve(root, inputPath);
  const relative = path.relative(root, resolved);
  if (
    relative.startsWith("..") ||
    path.isAbsolute(relative)
  ) {
    throw new Error(`Path escapes project root: ${inputPath}`);
  }

  if (mode === "write" && isGitInternalPath(relative)) {
    throw new Error(`Writes to .git are not allowed: ${inputPath}`);
  }

  return resolved;
}

function isGitInternalPath(relativePath: string): boolean {
  return relativePath === ".git" || relativePath.startsWith(`.git${path.sep}`);
}

function wireStream(
  stream: NodeJS.ReadableStream | null,
  onLine: (line: string) => void,
): void {
  if (!stream) {
    return;
  }

  let buffer = "";
  stream.setEncoding("utf8");
  stream.on("data", (chunk: string) => {
    buffer += chunk;
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      onLine(line);
    }
  });
  stream.on("end", () => {
    if (buffer) {
      onLine(buffer);
      buffer = "";
    }
  });
}

function normalizePatchFileArgs(args: PatchFileArgs): NormalizedPatchFileArgs {
  if (!args || typeof args !== "object") {
    throw new Error("Patch arguments must be an object");
  }

  const filePath = readRequiredNonEmptyString(
    (args as { path?: unknown }).path,
    "Patch path",
  );

  if (isMultiPatchArgs(args)) {
    if (!Array.isArray(args.edits) || args.edits.length === 0) {
      throw new Error(`Multi patch requires at least one edit for ${filePath}`);
    }

    return {
      kind: "multi",
      path: filePath,
      edits: args.edits.map((edit, index) => normalizePatchEdit(edit, filePath, index)),
    };
  }

  if (isRangePatchArgs(args)) {
    return {
      kind: "range",
      path: filePath,
      startLine: args.startLine,
      endLine: args.endLine,
      newContent: readRequiredString(args.newContent, "Patch newContent"),
    };
  }

  return {
    kind: "replace",
    path: filePath,
    oldString: readRequiredString(args.oldString, "Patch oldString"),
    newString: readRequiredString(args.newString, "Patch newString"),
    replaceAll: args.replaceAll ?? false,
  };
}

function normalizePatchEdit(
  edit: PatchEdit,
  filePath: string,
  editIndex: number,
): NormalizedPatchEdit {
  if (!edit || typeof edit !== "object") {
    throw new Error(`Patch edit ${editIndex + 1} in ${filePath} must be an object`);
  }

  if (isRangePatchEdit(edit)) {
    return {
      kind: "range",
      startLine: edit.startLine,
      endLine: edit.endLine,
      newContent: readRequiredString(edit.newContent, `Patch newContent for edit ${editIndex + 1}`),
    };
  }

  return {
    kind: "replace",
    oldString: readRequiredString(edit.oldString, `Patch oldString for edit ${editIndex + 1}`),
    newString: readRequiredString(edit.newString, `Patch newString for edit ${editIndex + 1}`),
    replaceAll: edit.replaceAll ?? false,
  };
}

function isRangePatchArgs(args: PatchFileArgs): args is Extract<PatchFileArgs, { kind: "range" }> {
  return "kind" in args && args.kind === "range";
}

function isMultiPatchArgs(args: PatchFileArgs): args is Extract<PatchFileArgs, { kind: "multi" }> {
  return "kind" in args && args.kind === "multi";
}

function isRangePatchEdit(edit: PatchEdit): edit is Extract<PatchEdit, { kind: "range" }> {
  return "kind" in edit && edit.kind === "range";
}

function applyPatchFile(
  before: string,
  args: NormalizedPatchFileArgs,
  relativePath: string,
): {
  next: string;
  mode: PatchFileResult["mode"];
  occurrences: number;
  appliedEdits: number;
} {
  switch (args.kind) {
    case "replace": {
      const result = applyReplaceEdit(before, args, relativePath);
      return {
        next: result.next,
        mode: "replace",
        occurrences: result.occurrences,
        appliedEdits: 1,
      };
    }
    case "range":
      return {
        next: applyRangeEdit(before, args, relativePath),
        mode: "range",
        occurrences: 0,
        appliedEdits: 1,
      };
    case "multi": {
      let current = before;
      let occurrences = 0;

      for (const [index, edit] of args.edits.entries()) {
        if (edit.kind === "replace") {
          const result = applyReplaceEdit(current, edit, relativePath, index);
          current = result.next;
          occurrences += result.occurrences;
          continue;
        }

        current = applyRangeEdit(current, edit, relativePath, index);
      }

      return {
        next: current,
        mode: "multi",
        occurrences,
        appliedEdits: args.edits.length,
      };
    }
  }
}

function applyReplaceEdit(
  input: string,
  edit: NormalizedReplaceEdit,
  relativePath: string,
  editIndex?: number,
): { next: string; occurrences: number } {
  if (!edit.oldString) {
    throw new Error(`Patch oldString must not be empty in ${formatPatchTarget(relativePath, editIndex)}`);
  }

  const occurrences = countOccurrences(input, edit.oldString);
  if (occurrences === 0) {
    throw new Error(`Patch context not found in ${formatPatchTarget(relativePath, editIndex)}`);
  }

  if (!edit.replaceAll && occurrences > 1) {
    throw new Error(
      `Multiple matches found in ${formatPatchTarget(relativePath, editIndex)}; set replaceAll=true or use a range edit`,
    );
  }

  const next = edit.replaceAll
    ? input.split(edit.oldString).join(edit.newString)
    : input.replace(edit.oldString, edit.newString);

  if (next === input) {
    throw new Error(`Patch produced no changes in ${formatPatchTarget(relativePath, editIndex)}`);
  }

  return {
    next,
    occurrences: edit.replaceAll ? occurrences : 1,
  };
}

function applyRangeEdit(
  input: string,
  edit: NormalizedRangeEdit,
  relativePath: string,
  editIndex?: number,
): string {
  if (
    !Number.isInteger(edit.startLine) ||
    !Number.isInteger(edit.endLine) ||
    edit.startLine < 1 ||
    edit.endLine < edit.startLine
  ) {
    throw new Error(`Invalid line range in ${formatPatchTarget(relativePath, editIndex)}`);
  }

  const lineEnding = detectLineEnding(input);
  const lines = splitExistingLines(input);
  if (edit.startLine > lines.length || edit.endLine > lines.length) {
    throw new Error(
      `startLine/endLine out of range in ${formatPatchTarget(relativePath, editIndex)}; file has ${lines.length} lines`,
    );
  }

  const replacementLines = splitReplacementLines(edit.newContent);
  const nextLines = [
    ...lines.slice(0, edit.startLine - 1),
    ...replacementLines,
    ...lines.slice(edit.endLine),
  ];
  const next = joinLines(nextLines, lineEnding);

  if (next === input) {
    throw new Error(`Patch produced no changes in ${formatPatchTarget(relativePath, editIndex)}`);
  }

  return next;
}

function formatPatchTarget(relativePath: string, editIndex?: number): string {
  if (editIndex === undefined) {
    return relativePath;
  }

  return `${relativePath} (edit ${editIndex + 1})`;
}

function detectLineEnding(input: string): string {
  return input.includes("\r\n") ? "\r\n" : "\n";
}

function splitExistingLines(input: string): string[] {
  if (input === "") {
    return [];
  }

  return normalizeLineEndings(input).split("\n");
}

function splitReplacementLines(input: string): string[] {
  if (input === "") {
    return [];
  }

  return normalizeLineEndings(input).split("\n");
}

function joinLines(lines: string[], lineEnding: string): string {
  if (lines.length === 0) {
    return "";
  }

  return lines.join(lineEnding);
}

function normalizeLineEndings(input: string): string {
  return input.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

function countOccurrences(input: string, search: string): number {
  if (!search) {
    return 0;
  }
  return input.split(search).length - 1;
}

function validateWriteFileArgs(args: WriteFileArgs): WriteFileArgs {
  if (!args || typeof args !== "object") {
    throw new Error("Write arguments must be an object");
  }

  return {
    path: readRequiredNonEmptyString(
      (args as { path?: unknown }).path,
      "Write path",
    ),
    content: readRequiredString(
      (args as { content?: unknown }).content,
      "Write content",
    ),
  };
}

function readRequiredString(value: unknown, label: string): string {
  if (typeof value !== "string") {
    throw new Error(`${label} must be a string`);
  }

  return value;
}

function readRequiredNonEmptyString(value: unknown, label: string): string {
  const stringValue = readRequiredString(value, label);
  if (!stringValue.trim()) {
    throw new Error(`${label} must be a non-empty string`);
  }

  return stringValue;
}
