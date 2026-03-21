import path from "node:path";
import { spawnSync } from "node:child_process";

export function resolveProjectRoot(options?: { cwd?: string }): string {
  if (options?.cwd) {
    return path.resolve(options.cwd);
  }

  const git = spawnSync("git", ["rev-parse", "--show-toplevel"], {
    cwd: process.cwd(),
    encoding: "utf8",
  });

  if (git.status === 0) {
    const stdout = git.stdout.trim();
    if (stdout) {
      return path.resolve(stdout);
    }
  }

  return process.cwd();
}

export function resolveCwd(projectRoot: string, requestedCwd?: string): string {
  const absolute = requestedCwd
    ? path.resolve(requestedCwd)
    : process.cwd();

  if (isWithinRoot(projectRoot, absolute)) {
    return absolute;
  }

  return projectRoot;
}

export function isWithinRoot(projectRoot: string, targetPath: string): boolean {
  const root = path.resolve(projectRoot);
  const target = path.resolve(targetPath);
  const relative = path.relative(root, target);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}
