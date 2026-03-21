import { spawnSync } from "node:child_process";
import { Command } from "commander";
import type { CliSessionState } from "./runtime/session-store.js";
import { SessionStore } from "./runtime/session-store.js";
import { loadResolvedConfig } from "./context/config-loader.js";
import { resolveCwd, resolveProjectRoot } from "./runtime/project-root.js";
import { runRepl } from "./repl.js";
import { runAgentTurn } from "./agent-loop.js";
import { runInterruptibleTurn, TurnCancelledError } from "./runtime/turn-control.js";
import { UiRenderer } from "./ui/renderer.js";

interface GlobalOptions {
  cwd?: string;
  prompt?: string;
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
    .action(async (options: GlobalOptions) => {
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
  const { config, sessionStore, session } = await prepareRuntime(options);

  if (options.prompt) {
    const ui = new UiRenderer();
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
  await runRepl({ config, session, sessionStore });
}

async function runResume(sessionId: string | undefined, options: GlobalOptions): Promise<void> {
  const { config, sessionStore } = await prepareRuntime(options);
  const session =
    (sessionId
      ? await sessionStore.load(sessionId)
      : await sessionStore.resolveLatestForProjectRoot(config.projectRoot)) ??
    (await sessionStore.create({
      cwd: config.cwd,
      projectRoot: config.projectRoot,
      assistantId: config.assistantId,
    }));
  session.cwd = config.cwd;
  session.projectRoot = config.projectRoot;
  await sessionStore.save(session);
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

async function runDoctor(options: GlobalOptions): Promise<void> {
  const { config } = await prepareRuntime(options);
  const ui = new UiRenderer();
  ui.printJson({
    node: process.version,
    projectRoot: config.projectRoot,
    cwd: config.cwd,
    apiUrl: config.apiUrl,
    apiKeyConfigured: Boolean(config.apiKey),
    assistantId: config.assistantId ?? null,
    git: runVersion("git", ["--version"]),
    rg: runVersion("rg", ["--version"]),
    pnpm: runVersion("pnpm", ["--version"]),
    xpertMd: config.xpertMdPath ?? null,
  });
}

async function prepareRuntime(options: GlobalOptions): Promise<{
  config: Awaited<ReturnType<typeof loadResolvedConfig>>;
  sessionStore: SessionStore;
  session: CliSessionState;
}> {
  const projectRoot = resolveProjectRoot({ cwd: options.cwd });
  const cwd = resolveCwd(projectRoot, options.cwd);
  const config = await loadResolvedConfig({ projectRoot, cwd });
  const sessionStore = new SessionStore(config.userConfigDir);
  const session =
    (await sessionStore.resolveLatestForProjectRoot(config.projectRoot)) ??
    (await sessionStore.create({
      cwd: config.cwd,
      projectRoot: config.projectRoot,
      assistantId: config.assistantId,
    }));

  session.cwd = config.cwd;
  session.projectRoot = config.projectRoot;
  session.assistantId = config.assistantId;

  return { config, sessionStore, session };
}

function runVersion(command: string, args: string[]): string | null {
  const result = spawnSync(command, args, { encoding: "utf8" });
  if (result.error || result.status !== 0) {
    return null;
  }
  return result.stdout.trim().split("\n")[0] ?? null;
}
