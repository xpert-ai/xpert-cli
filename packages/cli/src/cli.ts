import { spawnSync } from "node:child_process";
import { Command } from "commander";
import type { CliSessionState } from "./runtime/session-store.js";
import { SessionStore } from "./runtime/session-store.js";
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
    sessionId,
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
    sessionId?: string;
  },
): Promise<{
  config: Awaited<ReturnType<typeof loadResolvedConfig>>;
  sessionStore: SessionStore;
  session: CliSessionState;
  startupNotice?: string;
}> {
  const session =
    (input?.sessionId
      ? await runtime.sessionStore.load(input.sessionId)
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
