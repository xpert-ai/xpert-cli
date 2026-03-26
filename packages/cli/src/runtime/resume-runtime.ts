import os from "node:os";
import path from "node:path";
import { loadResolvedConfig } from "../context/config-loader.js";
import {
  isWithinRoot,
  resolveCwd,
  resolveProjectRoot,
} from "./project-root.js";
import { resetStaleRemoteStateIfNeeded } from "./remote-session.js";
import {
  resolveSessionSelector,
  type SessionSelectorResolution,
} from "./session-selector.js";
import { SessionStore, type CliSessionState } from "./session-store.js";
import {
  buildSessionSummaries,
  type SessionSummary,
} from "./session-summary.js";

export type ResumeSelectionKind =
  | "latest_current_project"
  | "prefix_current_project"
  | "exact_global";

export interface PreparedResumeRuntime {
  config: Awaited<ReturnType<typeof loadResolvedConfig>>;
  sessionStore: SessionStore;
  session: CliSessionState;
  selectionKind: ResumeSelectionKind;
  requestedProjectRoot: string;
  requestedCwd: string;
  effectiveProjectRoot: string;
  effectiveCwd: string;
  crossProject: boolean;
  startupNotice?: string;
}

interface ResumeTarget {
  selectionKind: ResumeSelectionKind;
  session?: CliSessionState;
  effectiveProjectRoot: string;
  effectiveCwd: string;
  crossProject: boolean;
  startupNotice?: string;
}

export async function prepareResumeRuntime(input: {
  cwd?: string;
  sessionSelector?: string;
}): Promise<PreparedResumeRuntime> {
  const shellProjectRoot = resolveProjectRoot();
  const requestedProjectRoot = resolveProjectRoot({ cwd: input.cwd });
  const requestedCwd = resolveCwd(requestedProjectRoot, input.cwd);
  const sessionStore = new SessionStore(path.join(os.homedir(), ".xpert-cli"));
  const target = await resolveResumeTarget({
    sessionStore,
    sessionSelector: input.sessionSelector,
    shellProjectRoot,
    requestedProjectRoot,
    requestedCwd,
    requestedCwdOverride: input.cwd,
  });
  const config = await loadResolvedConfig({
    projectRoot: target.effectiveProjectRoot,
    cwd: target.effectiveCwd,
  });
  const session =
    target.session ??
    (await sessionStore.create({
      cwd: target.effectiveCwd,
      projectRoot: target.effectiveProjectRoot,
      assistantId: config.assistantId,
    }));

  session.projectRoot = target.effectiveProjectRoot;
  session.cwd = target.effectiveCwd;

  const remoteSessionResult = resetStaleRemoteStateIfNeeded(session, config);

  return {
    config,
    sessionStore,
    session,
    selectionKind: target.selectionKind,
    requestedProjectRoot,
    requestedCwd,
    effectiveProjectRoot: target.effectiveProjectRoot,
    effectiveCwd: target.effectiveCwd,
    crossProject: target.crossProject,
    startupNotice: joinNotices(target.startupNotice, remoteSessionResult.notice),
  };
}

async function resolveResumeTarget(input: {
  sessionStore: SessionStore;
  sessionSelector?: string;
  shellProjectRoot: string;
  requestedProjectRoot: string;
  requestedCwd: string;
  requestedCwdOverride?: string;
}): Promise<ResumeTarget> {
  if (!input.sessionSelector) {
    const session = await input.sessionStore.resolveLatestForProjectRoot(input.requestedProjectRoot);
    return {
      selectionKind: "latest_current_project",
      session: session ?? undefined,
      effectiveProjectRoot: input.requestedProjectRoot,
      effectiveCwd: input.requestedCwd,
      crossProject: false,
    };
  }

  const normalizedSelector = input.sessionSelector.trim();
  if (!normalizedSelector) {
    throw new Error("Session selector cannot be empty.");
  }

  const exactMatch = await input.sessionStore.load(normalizedSelector);
  if (exactMatch) {
    return buildExactResumeTarget({
      session: exactMatch,
      shellProjectRoot: input.shellProjectRoot,
      requestedCwdOverride: input.requestedCwdOverride,
    });
  }

  const sessions = await input.sessionStore.list({
    projectRoot: input.requestedProjectRoot,
  });
  const resolution = resolveSessionSelector(sessions, normalizedSelector);
  if (!resolution.ok) {
    throw new Error(
      formatResumeSelectorError(resolution, {
        projectRoot: input.requestedProjectRoot,
      }),
    );
  }

  return {
    selectionKind: "prefix_current_project",
    session: resolution.session,
    effectiveProjectRoot: input.requestedProjectRoot,
    effectiveCwd: input.requestedCwd,
    crossProject: false,
  };
}

function buildExactResumeTarget(input: {
  session: CliSessionState;
  shellProjectRoot: string;
  requestedCwdOverride?: string;
}): ResumeTarget {
  const effectiveProjectRoot = path.resolve(input.session.projectRoot);
  const crossProject = path.resolve(input.shellProjectRoot) !== effectiveProjectRoot;
  const effectiveCwd = input.requestedCwdOverride
    ? resolveExactResumeOverrideCwd(
        effectiveProjectRoot,
        input.requestedCwdOverride,
        input.session,
        crossProject,
      )
    : normalizeResumedSessionCwd(effectiveProjectRoot, input.session.cwd);

  return {
    selectionKind: "exact_global",
    session: input.session,
    effectiveProjectRoot,
    effectiveCwd,
    crossProject,
    startupNotice: crossProject
      ? `resumed local session from ${effectiveProjectRoot}`
      : undefined,
  };
}

function normalizeResumedSessionCwd(projectRoot: string, savedCwd: string | undefined): string {
  if (!savedCwd) {
    return projectRoot;
  }

  const absoluteCwd = path.resolve(savedCwd);
  return isWithinRoot(projectRoot, absoluteCwd) ? absoluteCwd : projectRoot;
}

function resolveExactResumeOverrideCwd(
  projectRoot: string,
  requestedCwd: string,
  session: CliSessionState,
  crossProject: boolean,
): string {
  const absoluteCwd = path.isAbsolute(requestedCwd)
    ? path.resolve(requestedCwd)
    : path.resolve(projectRoot, requestedCwd);

  if (isWithinRoot(projectRoot, absoluteCwd)) {
    return absoluteCwd;
  }

  throw new Error(
    crossProject
      ? [
          `Cannot resume session "${session.sessionId}" with --cwd "${requestedCwd}".`,
          `This resume target belongs to another project: ${projectRoot}.`,
          "--cwd must stay within that project.",
        ].join("\n")
      : [
          `Cannot resume session "${session.sessionId}" with --cwd "${requestedCwd}".`,
          `This resume target uses project root ${projectRoot}.`,
          "--cwd must stay within that project.",
        ].join("\n"),
  );
}

function joinNotices(...notices: Array<string | undefined>): string | undefined {
  const lines = notices.filter((notice): notice is string => Boolean(notice?.trim()));
  return lines.length > 0 ? lines.join("\n") : undefined;
}

function formatResumeSelectorError(
  resolution: Extract<SessionSelectorResolution, { ok: false }>,
  options: {
    projectRoot: string;
  },
): string {
  if (resolution.reason === "not_found") {
    return [
      `Session selector "${resolution.selector}" was not found.`,
      `Exact ids are matched globally; prefixes are matched within ${options.projectRoot}.`,
      "Run `xpert sessions list --all-projects` to inspect all local sessions.",
    ].join("\n");
  }

  const matches = buildSessionSummaries(resolution.matches);
  return [
    `Session selector "${resolution.selector}" is ambiguous for ${options.projectRoot}.`,
    "Matching sessions:",
    ...matches.map((summary) => `- ${formatSessionMatchLine(summary)}`),
    "Use a longer prefix or the full session id.",
  ].join("\n");
}

function formatSessionMatchLine(summary: SessionSummary): string {
  return `${summary.shortId}  ${summary.updatedAt}  ${summary.lastTurnStatus}  ${summary.turnCount} turn${summary.turnCount === 1 ? "" : "s"}  ${summary.title}`;
}
