import { spawn, spawnSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import fg from "fast-glob";
import { createUnifiedDiff } from "../../ui/diff.js";
import { createAbortError, throwIfAborted } from "../../runtime/turn-control.js";
import type { ExecutionBackend } from "../contracts.js";

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

  async patchFile(args: {
    path: string;
    oldString: string;
    newString: string;
    replaceAll?: boolean;
  }): Promise<{ path: string; diff: string; occurrences: number }> {
    const absolutePath = resolveWorkspacePath(this.#projectRoot, args.path, "write");
    const before = await readFile(absolutePath, "utf8");
    const occurrences = countOccurrences(before, args.oldString);
    if (occurrences === 0) {
      throw new Error(`Patch context not found in ${args.path}`);
    }

    const next = args.replaceAll
      ? before.split(args.oldString).join(args.newString)
      : before.replace(args.oldString, args.newString);

    if (before === next) {
      throw new Error(`Patch produced no changes for ${args.path}`);
    }

    await writeFile(absolutePath, next, "utf8");

    return {
      path: path.relative(this.#projectRoot, absolutePath),
      diff: createUnifiedDiff(path.relative(this.#projectRoot, absolutePath), before, next),
      occurrences: args.replaceAll ? occurrences : 1,
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

function countOccurrences(input: string, search: string): number {
  if (!search) {
    return 0;
  }
  return input.split(search).length - 1;
}
