import { spawnSync } from "node:child_process";
import path from "node:path";
import { Command } from "commander";
import type { CliSessionState } from "./runtime/session-store.js";
import { SessionStore } from "./runtime/session-store.js";
import {
  buildSessionSummary,
  buildSessionSummaries,
  type SessionSummary,
} from "./runtime/session-summary.js";
import {
  resolveSessionSelector,
  type SessionSelectorResolution,
} from "./runtime/session-selector.js";
import { resetStaleRemoteStateIfNeeded } from "./runtime/remote-session.js";
import {
  assertCliPreflight,
  renderDoctorReport,
  runCliPreflight,
} from "./runtime/preflight.js";
import { loadResolvedConfig } from "./context/config-loader.js";
import { resolveCwd, resolveProjectRoot } from "./runtime/project-root.js";
import { runRepl } from "./repl.js";
import { runAgentTurn } from "./agent-loop.js";
import { runInterruptibleTurn, TurnCancelledError } from "./runtime/turn-control.js";
import { UiRenderer } from "./ui/renderer.js";
import { resolveCliExecutionMode } from "./ui/mode.js";

interface GlobalOptions {
  cwd?: string;
  prompt?: string;
}

interface DoctorCommandOptions extends GlobalOptions {
  json?: boolean;
}

interface SessionsListCommandOptions extends GlobalOptions {
  json?: boolean;
  allProjects?: boolean;
  limit?: string;
}

interface SessionsPruneCommandOptions extends GlobalOptions {
  keep?: string;
  allProjects?: boolean;
  yes?: boolean;
}

const DEFAULT_SESSION_LIST_LIMIT = 10;
const DEFAULT_SESSION_PRUNE_KEEP = 5;

export async function runCli(argv: string[]): Promise<void> {
  const program = new Command();

  program
    .name("xpert")
    .option("--cwd <path>", "Project working directory")
    .option("-p, --prompt <prompt>", "Run a single prompt and exit")
    .action(async (options: GlobalOptions) => {
      await runMain(options);
    });

  program
    .command("auth")
    .command("status")
    .option("--cwd <path>", "Project working directory")
    .action(async (options: GlobalOptions) => {
      await runAuthStatus(options);
    });

  program
    .command("doctor")
    .option("--cwd <path>", "Project working directory")
    .option("--json", "Output machine-readable JSON")
    .action(async (options: DoctorCommandOptions) => {
      await runDoctor(options);
    });

  const sessionsCommand = program.command("sessions");

  sessionsCommand
    .command("list", { isDefault: true })
    .option("--cwd <path>", "Project working directory")
    .option("--json", "Output machine-readable JSON")
    .option("--all-projects", "List sessions across all local projects")
    .option("--limit <n>", "Limit listed sessions")
    .action(async (options: SessionsListCommandOptions) => {
      await runSessionsList(options);
    });

  sessionsCommand
    .command("delete <selector>")
    .option("--cwd <path>", "Project working directory")
    .action(async (selector: string, options: GlobalOptions) => {
      await runSessionsDelete(selector, options);
    });

  sessionsCommand
    .command("prune")
    .option("--cwd <path>", "Project working directory")
    .option("--keep <n>", "Keep the most recent N local sessions")
    .option("--all-projects", "Prune sessions across all local projects")
    .option("--yes", "Delete matching sessions without prompting")
    .action(async (options: SessionsPruneCommandOptions) => {
      await runSessionsPrune(options);
    });

  program
    .command("resume [sessionId]")
    .option("--cwd <path>", "Project working directory")
    .action(async (sessionId: string | undefined, options: GlobalOptions) => {
      await runResume(sessionId, options);
    });

  await program.parseAsync(argv, { from: "user" });
}

async function runMain(options: GlobalOptions): Promise<void> {
  const mode = resolveCliExecutionMode({
    prompt: options.prompt,
    stdinIsTTY: process.stdin.isTTY,
    stdoutIsTTY: process.stdout.isTTY,
  });
  const ui = new UiRenderer();
  const runtime = await prepareRuntime(options);
  const { config, sessionStore, session, startupNotice } = await prepareSessionRuntime(runtime);

  await sessionStore.save(session);
  if (startupNotice) {
    ui.printWarning(startupNotice);
  }
  assertCliPreflight(await runCliPreflight(config, { mode: "light" }));

  if (mode === "single_prompt") {
    try {
      const nextSession = await runInterruptibleTurn(
        (signal) =>
          runAgentTurn({
            prompt: options.prompt!,
            config,
            session,
            interactive: process.stdout.isTTY,
            signal,
          }),
        {
          onCancel: () => {
            ui.printLine();
            ui.printWarning("cancelled current turn");
          },
        },
      );
      await sessionStore.save(nextSession);
    } catch (error) {
      if (error instanceof TurnCancelledError) {
        await sessionStore.save(session);
        process.exitCode = 130;
        return;
      }
      await sessionStore.save(session);
      throw error;
    }
    return;
  }

  await sessionStore.save(session);
  if (mode === "interactive_ink") {
    const { runInteractiveApp } = await import("./interactive.js");
    await runInteractiveApp({ config, session, sessionStore });
    return;
  }

  await runRepl({ config, session, sessionStore });
}

async function runResume(sessionId: string | undefined, options: GlobalOptions): Promise<void> {
  const ui = new UiRenderer();
  const runtime = await prepareRuntime(options);
  const { config, sessionStore, session, startupNotice } = await prepareSessionRuntime(runtime, {
    sessionSelector: sessionId,
  });

  await sessionStore.save(session);
  if (startupNotice) {
    ui.printWarning(startupNotice);
  }
  assertCliPreflight(await runCliPreflight(config, { mode: "light" }));

  if (
    resolveCliExecutionMode({
      stdinIsTTY: process.stdin.isTTY,
      stdoutIsTTY: process.stdout.isTTY,
    }) === "interactive_ink"
  ) {
    const { runInteractiveApp } = await import("./interactive.js");
    await runInteractiveApp({ config, session, sessionStore });
    return;
  }

  await runRepl({ config, session, sessionStore });
}

async function runAuthStatus(options: GlobalOptions): Promise<void> {
  const { config } = await prepareRuntime(options);
  const ui = new UiRenderer();
  ui.printJson({
    apiUrl: config.apiUrl,
    apiKeyConfigured: Boolean(config.apiKey),
    assistantId: config.assistantId ?? null,
    organizationId: config.organizationId ?? null,
    approvalMode: config.approvalMode,
    sandboxMode: config.sandboxMode,
  });
}

async function runDoctor(options: DoctorCommandOptions): Promise<void> {
  const { config } = await prepareRuntime(options);
  const ui = new UiRenderer();
  const environment = {
    node: process.version,
    projectRoot: config.projectRoot,
    cwd: config.cwd,
    git: runVersion("git", ["--version"]),
    rg: runVersion("rg", ["--version"]),
    pnpm: runVersion("pnpm", ["--version"]),
    xpertMd: config.xpertMdPath ?? null,
  };
  const report = await runCliPreflight(config, { mode: "doctor" });

  if (options.json) {
    ui.printJson({
      ...environment,
      report,
    });
  } else {
    ui.printLine(
      [
        `node: ${environment.node}`,
        `git: ${environment.git ?? "(missing)"}`,
        `rg: ${environment.rg ?? "(missing)"}`,
        `pnpm: ${environment.pnpm ?? "(missing)"}`,
        `xpertMd: ${environment.xpertMd ?? "(none)"}`,
        "",
        renderDoctorReport(report),
      ].join("\n"),
    );
  }

  if (!report.ok) {
    process.exitCode = 1;
  }
}

async function runSessionsList(options: SessionsListCommandOptions): Promise<void> {
  const ui = new UiRenderer();
  const { config, sessionStore } = await prepareRuntime(options);
  const limit = parseNonNegativeIntegerOption(options.limit, "--limit") ?? DEFAULT_SESSION_LIST_LIMIT;
  const allProjects = options.allProjects === true;
  const projectRoot = allProjects ? undefined : config.projectRoot;
  const sessions = await sessionStore.list({ projectRoot });
  const summaries = buildSessionSummaries(sessions);
  const visibleSummaries = summaries.slice(0, limit);

  if (options.json) {
    ui.printJson({
      scope: allProjects ? "all-projects" : "project",
      projectRoot: projectRoot ?? null,
      count: visibleSummaries.length,
      totalCount: summaries.length,
      limit,
      sessions: visibleSummaries,
    });
    return;
  }

  ui.printLine(
    formatSessionListOutput({
      allProjects,
      projectRoot: config.projectRoot,
      totalCount: summaries.length,
      limit,
      sessions: visibleSummaries,
    }),
  );
}

async function runSessionsDelete(selector: string, options: GlobalOptions): Promise<void> {
  const ui = new UiRenderer();
  const { config, sessionStore } = await prepareRuntime(options);
  const session = await resolveRequiredSessionSelection(
    sessionStore,
    selector,
    {
      projectRoot: config.projectRoot,
    },
  );
  const deleted = await sessionStore.delete(session.sessionId);
  if (!deleted) {
    throw new Error(`Local session "${session.sessionId}" no longer exists.`);
  }

  const summary = buildSessionSummary(session);
  ui.printSuccess(`deleted local session ${summary.shortId} ${summary.title}`);
}

async function runSessionsPrune(options: SessionsPruneCommandOptions): Promise<void> {
  const ui = new UiRenderer();
  const { config, sessionStore } = await prepareRuntime(options);
  const keep = parseNonNegativeIntegerOption(options.keep, "--keep") ?? DEFAULT_SESSION_PRUNE_KEEP;
  const allProjects = options.allProjects === true;
  const projectRoot = allProjects ? undefined : config.projectRoot;
  const sessions = await sessionStore.list({ projectRoot });
  const candidates = sessions.slice(keep);

  if (candidates.length === 0) {
    ui.printLine("nothing to prune");
    return;
  }

  if (!options.yes) {
    throw new Error(
      formatPruneConfirmationError({
        allProjects,
        projectRoot: config.projectRoot,
        keep,
        candidates: buildSessionSummaries(candidates),
      }),
    );
  }

  const result = await sessionStore.prune({ keep, projectRoot });
  if (result.deleted.length === 0) {
    ui.printLine("nothing to prune");
    return;
  }

  ui.printSuccess(
    `pruned ${result.deleted.length} local session${result.deleted.length === 1 ? "" : "s"}; kept ${result.kept.length}`,
  );
}

export async function prepareRuntime(options: GlobalOptions): Promise<{
  config: Awaited<ReturnType<typeof loadResolvedConfig>>;
  sessionStore: SessionStore;
}> {
  const projectRoot = resolveProjectRoot({ cwd: options.cwd });
  const cwd = resolveCwd(projectRoot, options.cwd);
  const config = await loadResolvedConfig({ projectRoot, cwd });
  const sessionStore = new SessionStore(config.userConfigDir);
  return { config, sessionStore };
}

export async function prepareSessionRuntime(
  runtime: Awaited<ReturnType<typeof prepareRuntime>>,
  input?: {
    sessionSelector?: string;
  },
): Promise<{
  config: Awaited<ReturnType<typeof loadResolvedConfig>>;
  sessionStore: SessionStore;
  session: CliSessionState;
  startupNotice?: string;
}> {
  const session =
    (input?.sessionSelector
      ? await resolveRequiredSessionSelection(
          runtime.sessionStore,
          input.sessionSelector,
          {
            projectRoot: runtime.config.projectRoot,
            allowGlobalExactId: true,
          },
        )
      : await runtime.sessionStore.resolveLatestForProjectRoot(runtime.config.projectRoot)) ??
    (await runtime.sessionStore.create({
      cwd: runtime.config.cwd,
      projectRoot: runtime.config.projectRoot,
      assistantId: runtime.config.assistantId,
    }));

  session.cwd = runtime.config.cwd;
  session.projectRoot = runtime.config.projectRoot;

  const remoteSessionResult = resetStaleRemoteStateIfNeeded(session, runtime.config);

  return {
    ...runtime,
    session,
    startupNotice: remoteSessionResult.notice,
  };
}

function runVersion(command: string, args: string[]): string | null {
  const result = spawnSync(command, args, { encoding: "utf8" });
  if (result.error || result.status !== 0) {
    return null;
  }
  return result.stdout.trim().split("\n")[0] ?? null;
}

async function resolveRequiredSessionSelection(
  sessionStore: SessionStore,
  selector: string,
  options: {
    projectRoot: string;
    allowGlobalExactId?: boolean;
  },
): Promise<CliSessionState> {
  const normalizedSelector = selector.trim();
  if (options.allowGlobalExactId && normalizedSelector) {
    const exactMatch = await sessionStore.load(normalizedSelector);
    if (exactMatch) {
      return exactMatch;
    }
  }

  const sessions = await sessionStore.list({ projectRoot: options.projectRoot });
  const resolution = resolveSessionSelector(sessions, selector);
  if (resolution.ok) {
    return resolution.session;
  }

  throw new Error(formatSessionSelectorError(resolution, options));
}

function formatSessionSelectorError(
  resolution: Extract<SessionSelectorResolution, { ok: false }>,
  options: {
    projectRoot: string;
    allowGlobalExactId?: boolean;
  },
): string {
  if (resolution.reason === "not_found") {
    if (options.allowGlobalExactId) {
      return [
        `Session selector "${resolution.selector}" was not found.`,
        `Exact ids are matched globally; prefixes are matched within ${options.projectRoot}.`,
        "Run `xpert sessions list --all-projects` to inspect all local sessions.",
      ].join("\n");
    }

    return [
      `Session selector "${resolution.selector}" was not found for ${options.projectRoot}.`,
      "Run `xpert sessions list` to inspect local sessions in this project.",
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

function formatPruneConfirmationError(input: {
  allProjects: boolean;
  projectRoot: string;
  keep: number;
  candidates: SessionSummary[];
}): string {
  const scopeLabel = input.allProjects
    ? "all local projects"
    : input.projectRoot;
  return [
    `Refusing to prune ${input.candidates.length} local session${input.candidates.length === 1 ? "" : "s"} for ${scopeLabel} without --yes.`,
    `Re-run \`xpert sessions prune --keep ${input.keep}${input.allProjects ? " --all-projects" : ""} --yes\` to delete them.`,
    "Prune candidates:",
    ...input.candidates.map((summary) => `- ${formatSessionMatchLine(summary)}`),
  ].join("\n");
}

function formatSessionListOutput(input: {
  allProjects: boolean;
  projectRoot: string;
  totalCount: number;
  limit: number;
  sessions: SessionSummary[];
}): string {
  const lines = [
    input.allProjects
      ? "All local sessions"
      : `Local sessions for ${input.projectRoot}`,
    "",
  ];

  if (input.totalCount === 0) {
    lines.push("No local sessions found.");
    return lines.join("\n");
  }

  if (input.sessions.length < input.totalCount) {
    lines.push(`Showing ${input.sessions.length} of ${input.totalCount} local sessions.`);
    lines.push("");
  }

  for (const summary of input.sessions) {
    lines.push(
      `${summary.shortId}  ${summary.updatedAt}  ${summary.lastTurnStatus}  ${formatTurnCount(summary.turnCount)}  ${summary.title}`,
    );
    lines.push(`  ${formatSessionDetails(summary, input.allProjects)}`);
  }

  return lines.join("\n");
}

function formatSessionMatchLine(summary: SessionSummary): string {
  return `${summary.shortId}  ${summary.updatedAt}  ${summary.lastTurnStatus}  ${formatTurnCount(summary.turnCount)}  ${summary.title}`;
}

function formatSessionDetails(summary: SessionSummary, allProjects: boolean): string {
  const parts: string[] = [];
  if (allProjects) {
    parts.push(`project: ${summary.projectRoot}`);
  }

  parts.push(`cwd: ${formatSessionCwd(summary)}`);
  parts.push(`assistant: ${summary.assistantId ?? "(unconfigured)"}`);
  parts.push(`remote: ${summary.hasRemoteState ? "yes" : "no"}`);
  if (summary.latestPromptPreview) {
    parts.push(`latest: ${summary.latestPromptPreview}`);
  }

  return parts.join("  ");
}

function formatSessionCwd(summary: SessionSummary): string {
  const relative = path.relative(summary.projectRoot, summary.cwd);
  if (relative === "") {
    return ".";
  }

  if (!relative.startsWith("..") && !path.isAbsolute(relative)) {
    return relative;
  }

  return summary.cwd;
}

function formatTurnCount(turnCount: number): string {
  return `${turnCount} turn${turnCount === 1 ? "" : "s"}`;
}

function parseNonNegativeIntegerOption(
  value: string | undefined,
  flagName: string,
): number | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (!/^\d+$/.test(value)) {
    throw new Error(`${flagName} must be a non-negative integer`);
  }

  return Number(value);
}
