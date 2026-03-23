import type { ResolvedXpertCliConfig, ToolCallSummary } from "@xpert-cli/contracts";
import { buildRunLocalContext } from "../context/run-context.js";
import type { CliSessionState } from "../runtime/session-store.js";
import type { TurnTranscript } from "../runtime/turn-transcript.js";
import { createToolRegistry } from "../tools/registry.js";
import type { ToolRegistry } from "../tools/contracts.js";
import type { UiHistoryItemInput } from "./history.js";

export interface SlashCommandContext {
  config: ResolvedXpertCliConfig;
  session: CliSessionState;
  toolRegistry?: ToolRegistry;
  deps?: {
    buildRunLocalContext?: typeof buildRunLocalContext;
    createToolRegistry?: typeof createToolRegistry;
  };
}

export type SlashCommandResult =
  | { type: "exit" }
  | { type: "history"; item: UiHistoryItemInput };

export async function runSlashCommand(
  input: string,
  context: SlashCommandContext,
): Promise<SlashCommandResult> {
  const [rawName] = input.trim().slice(1).split(/\s+/, 1);
  const name = rawName?.toLowerCase();

  if (!name) {
    return {
      type: "history",
      item: {
        type: "warning",
        text: "Empty slash command",
      },
    };
  }

  switch (name) {
    case "exit":
      return { type: "exit" };
    case "status":
      return {
        type: "history",
        item: await buildStatusView(context),
      };
    case "tools":
      return {
        type: "history",
        item: buildToolsView(context),
      };
    case "session":
      return {
        type: "history",
        item: buildSessionView(context.session),
      };
    default:
      return {
        type: "history",
        item: {
          type: "warning",
          text: `Unknown command: /${name}`,
        },
      };
  }
}

export async function buildStatusView(
  context: SlashCommandContext,
): Promise<UiHistoryItemInput> {
  const getLocalContext = context.deps?.buildRunLocalContext ?? buildRunLocalContext;
  const localContext = await getLocalContext({
    config: context.config,
    session: context.session,
  });

  const lines = [
    `cwd: ${localContext.cwd}`,
    `projectRoot: ${localContext.projectRoot}`,
    `sessionId: ${context.session.sessionId}`,
    `threadId: ${context.session.threadId ?? "(none)"}`,
    `runId: ${context.session.runId ?? "(none)"}`,
    `assistant: ${context.config.assistantId ?? "(unconfigured)"}`,
    `model: ${context.config.defaultModel ?? "(unconfigured)"}`,
    `approvalMode: ${context.config.approvalMode}`,
    `git: ${summarizeGit(localContext.git)}`,
    "",
    "Recent changed files:",
    ...formatList(
      localContext.workingSet.recentFiles,
      (filePath) => filePath,
      "  - none",
    ),
    "",
    "Recent tool calls:",
    ...formatList(
      localContext.workingSet.recentToolCalls,
      (entry) => `${entry.toolName} [${entry.status}] ${entry.summary}`,
      "  - none",
    ),
  ];

  return {
    type: "status_view",
    title: "Status",
    lines,
  };
}

export function buildToolsView(context: SlashCommandContext): UiHistoryItemInput {
  const registryFactory = context.deps?.createToolRegistry ?? createToolRegistry;
  const registry = context.toolRegistry ?? registryFactory();
  const tools = [...registry.tools.values()];
  const failedCalls = collectRecentFailedToolCalls(context.session.turns);

  return {
    type: "tools_view",
    title: "Tools",
    lines: [
      "Available tools:",
      ...formatList(
        tools,
        (tool) => `${tool.name}: ${tool.description}`,
        "  - none",
      ),
      "",
      "Recent tool calls:",
      ...formatList(
        context.session.recentToolCalls,
        (entry) => `${entry.toolName} [${entry.status}] ${entry.summary}`,
        "  - none",
      ),
      "",
      "Recent failed tool calls:",
      ...formatList(
        failedCalls,
        (entry) => `${entry.toolName} [${entry.status}] ${entry.resultSummary}`,
        "  - none",
      ),
    ],
  };
}

export function buildSessionView(session: Pick<CliSessionState, "turns">): UiHistoryItemInput {
  return {
    type: "session_view",
    title: "Session",
    lines: buildSessionSummaryLines(session.turns),
  };
}

export function buildSessionSummaryLines(turns: TurnTranscript[]): string[] {
  if (turns.length === 0) {
    return ["No turns recorded yet."];
  }

  const lines: string[] = [];
  const recentTurns = [...turns].slice(-5).reverse();

  for (const turn of recentTurns) {
    const completedAt = turn.finishedAt ?? turn.startedAt;
    lines.push(
      `${turn.status.toUpperCase()} ${completedAt} turn=${shortId(turn.turnId)}`,
    );
    lines.push(`  prompt: ${clip(turn.prompt, 140)}`);
    if (turn.assistantText) {
      lines.push(`  assistant: ${clip(turn.assistantText, 180)}`);
    }
    if (turn.toolEvents.length > 0) {
      lines.push(
        `  tools: ${turn.toolEvents
          .map((event) => `${event.toolName} [${event.status}] ${clip(event.resultSummary ?? event.argsSummary, 80)}`)
          .join("; ")}`,
      );
    }
    if (turn.permissionEvents.length > 0) {
      lines.push(
        `  permissions: ${turn.permissionEvents
          .map(
            (event) =>
              `${event.toolName} ${event.decision}${event.scope ? ` @ ${event.scope}` : ""}`,
          )
          .join("; ")}`,
      );
    }
    if (turn.changedFiles.length > 0) {
      lines.push(`  files: ${turn.changedFiles.join(", ")}`);
    }
    if (turn.error) {
      lines.push(`  error: ${clip(turn.error, 160)}`);
    }
    lines.push(
      `  ids: thread=${turn.threadId ?? "(none)"} run=${turn.runId ?? "(none)"} checkpoint=${turn.checkpointId ?? "(none)"}`,
    );
    lines.push("");
  }

  if (lines[lines.length - 1] === "") {
    lines.pop();
  }

  return lines;
}

export function summarizeGit(git: Awaited<ReturnType<typeof buildRunLocalContext>>["git"]): string {
  if (!git.available) {
    return `unavailable (${git.reason ?? "git unavailable"})`;
  }

  if (!git.isRepo) {
    return `not a repo (${git.reason ?? "git unavailable"})`;
  }

  const status = git.statusShort?.trim();
  if (!status) {
    return "clean";
  }

  const lines = status.split("\n");
  return `dirty (${lines.length} changes)`;
}

function collectRecentFailedToolCalls(
  turns: TurnTranscript[],
): Array<{ toolName: string; status: string; resultSummary: string }> {
  const failures: Array<{ toolName: string; status: string; resultSummary: string }> = [];

  for (const turn of [...turns].reverse()) {
    for (const event of [...turn.toolEvents].reverse()) {
      if (event.status === "success") {
        continue;
      }

      failures.push({
        toolName: event.toolName,
        status: event.status,
        resultSummary: event.resultSummary ?? event.argsSummary,
      });

      if (failures.length >= 5) {
        return failures;
      }
    }
  }

  return failures;
}

function formatList<T>(
  items: readonly T[],
  renderItem: (item: T) => string,
  emptyLine: string,
): string[] {
  if (items.length === 0) {
    return [emptyLine];
  }

  return items.map((item) => `  - ${renderItem(item)}`);
}

function clip(value: string, maxChars: number): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxChars) {
    return normalized;
  }

  return `${normalized.slice(0, maxChars - 3)}...`;
}

function shortId(value: string): string {
  return value.slice(0, 8);
}
