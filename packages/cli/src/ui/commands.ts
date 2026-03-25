import type {
  PermissionRecord,
  ResolvedXpertCliConfig,
  ToolCallSummary,
} from "@xpert-cli/contracts";
import { buildRunLocalContext } from "../context/run-context.js";
import type { CliSessionState } from "../runtime/session-store.js";
import type { TurnTranscript } from "../runtime/turn-transcript.js";
import { createToolRegistry } from "../tools/registry.js";
import type { ToolRegistry } from "../tools/contracts.js";
import type { UiHistoryItemInput } from "./history.js";

export interface SlashCommandContext {
  config: ResolvedXpertCliConfig;
  session: CliSessionState;
  presentation?: "ink" | "text";
  toolRegistry?: ToolRegistry;
  deps?: {
    buildRunLocalContext?: typeof buildRunLocalContext;
    createToolRegistry?: typeof createToolRegistry;
  };
}

export type InspectorPanel = "status" | "tools" | "session";

export interface InspectorPanelSection {
  title: string;
  lines: string[];
}

export interface InspectorPanelData {
  panel: InspectorPanel;
  title: string;
  sections: InspectorPanelSection[];
}

export type SlashCommandResult =
  | { type: "exit" }
  | { type: "history"; item: UiHistoryItemInput }
  | { type: "panel"; panel: InspectorPanel; data: InspectorPanelData };

export async function runSlashCommand(
  input: string,
  context: SlashCommandContext,
): Promise<SlashCommandResult> {
  const [rawName] = input.trim().slice(1).split(/\s+/, 1);
  const name = rawName?.toLowerCase();
  const presentation = context.presentation ?? "text";

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
    case "status": {
      const data = await buildStatusPanelData(context);
      return presentation === "ink"
        ? {
            type: "panel",
            panel: "status",
            data,
          }
        : {
            type: "history",
            item: panelDataToHistoryItem(data),
          };
    }
    case "tools": {
      const data = buildToolsPanelData(context);
      return presentation === "ink"
        ? {
            type: "panel",
            panel: "tools",
            data,
          }
        : {
            type: "history",
            item: panelDataToHistoryItem(data),
          };
    }
    case "session": {
      const data = buildSessionPanelData(context.session);
      return presentation === "ink"
        ? {
            type: "panel",
            panel: "session",
            data,
          }
        : {
            type: "history",
            item: panelDataToHistoryItem(data),
          };
    }
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

export async function buildStatusPanelData(
  context: SlashCommandContext,
): Promise<InspectorPanelData> {
  const getLocalContext = context.deps?.buildRunLocalContext ?? buildRunLocalContext;
  const localContext = await getLocalContext({
    config: context.config,
    session: context.session,
  });
  const gitLines = buildGitSection(localContext.git);

  return {
    panel: "status",
    title: "Status",
    sections: [
      {
        title: "Runtime",
        lines: [
          `cwd: ${localContext.cwd}`,
          `projectRoot: ${localContext.projectRoot}`,
          `sessionId: ${context.session.sessionId}`,
          `threadId: ${context.session.threadId ?? "(none)"}`,
          `runId: ${context.session.runId ?? "(none)"}`,
          `checkpointId: ${context.session.checkpointId ?? "(none)"}`,
        ],
      },
      {
        title: "Assistant",
        lines: [
          `assistant: ${context.session.assistantId ?? context.config.assistantId ?? "(unconfigured)"}`,
          `model: ${context.config.defaultModel ?? "(unconfigured)"}`,
          `approvalMode: ${context.config.approvalMode}`,
        ],
      },
      {
        title: "Git",
        lines: gitLines,
      },
      {
        title: "Recent Files",
        lines: formatList(
          localContext.workingSet.recentFiles,
          (filePath) => filePath,
          "(none)",
        ),
      },
      {
        title: "Recent Tool Calls",
        lines: formatList(
          localContext.workingSet.recentToolCalls,
          (entry) => `${entry.toolName} [${entry.status}] ${entry.summary}`,
          "(none)",
        ),
      },
    ],
  };
}

export async function buildStatusView(
  context: SlashCommandContext,
): Promise<UiHistoryItemInput> {
  return panelDataToHistoryItem(await buildStatusPanelData(context));
}

export function buildToolsPanelData(context: SlashCommandContext): InspectorPanelData {
  const registryFactory = context.deps?.createToolRegistry ?? createToolRegistry;
  const registry = context.toolRegistry ?? registryFactory();
  const tools = [...registry.tools.values()];
  const failedCalls = collectRecentFailedToolCalls(context.session.turns);
  const recentApprovals = [...context.session.approvals].slice(-5).reverse();

  return {
    panel: "tools",
    title: "Tools",
    sections: [
      {
        title: "Available Tools",
        lines: formatList(
          tools,
          (tool) => `${tool.name}: ${tool.description}`,
          "(none)",
        ),
      },
      {
        title: "Recent Tool Calls",
        lines: formatList(
          context.session.recentToolCalls,
          (entry) => `${entry.toolName} [${entry.status}] ${entry.summary}`,
          "(none)",
        ),
      },
      {
        title: "Recent Failed Tool Calls",
        lines: formatList(
          failedCalls,
          (entry) => `${entry.toolName} [${entry.status}] ${entry.resultSummary}`,
          "(none)",
        ),
      },
      {
        title: "Permission Decisions",
        lines: formatList(
          recentApprovals,
          (record) => formatApprovalRecord(record),
          "(none)",
        ),
      },
    ],
  };
}

export function buildToolsView(context: SlashCommandContext): UiHistoryItemInput {
  return panelDataToHistoryItem(buildToolsPanelData(context));
}

export function buildSessionPanelData(
  session: Pick<CliSessionState, "turns">,
): InspectorPanelData {
  if (session.turns.length === 0) {
    return {
      panel: "session",
      title: "Session",
      sections: [
        {
          title: "Recent Turns",
          lines: ["No turns recorded yet."],
        },
      ],
    };
  }

  return {
    panel: "session",
    title: "Session",
    sections: [...session.turns]
      .slice(-5)
      .reverse()
      .map((turn) => {
        const completedAt = turn.finishedAt ?? turn.startedAt;
        const lines = [
          `prompt: ${clip(turn.prompt, 140)}`,
          ...(turn.assistantText
            ? [`assistant: ${clip(turn.assistantText, 180)}`]
            : []),
          ...(turn.toolEvents.length > 0
            ? [
                `tools: ${turn.toolEvents
                  .map(
                    (event) =>
                      `${event.toolName} [${event.status}] ${clip(event.resultSummary ?? event.argsSummary, 80)}`,
                  )
                  .join("; ")}`,
              ]
            : []),
          ...(turn.permissionEvents.length > 0
            ? [
                `permissions: ${turn.permissionEvents
                  .map(
                    (event) =>
                      `${event.toolName} ${event.decision}${event.scope ? ` @ ${event.scope}` : ""}`,
                  )
                  .join("; ")}`,
              ]
            : []),
          ...(turn.changedFiles.length > 0
            ? [`files: ${turn.changedFiles.join(", ")}`]
            : []),
          ...(turn.error ? [`error: ${clip(turn.error, 160)}`] : []),
          `ids: thread=${turn.threadId ?? "(none)"} run=${turn.runId ?? "(none)"} checkpoint=${turn.checkpointId ?? "(none)"}`,
        ];

        return {
          title: `${turn.status.toUpperCase()} ${completedAt} turn=${shortId(turn.turnId)}`,
          lines,
        };
      }),
  };
}

export function buildSessionView(session: Pick<CliSessionState, "turns">): UiHistoryItemInput {
  return panelDataToHistoryItem(buildSessionPanelData(session));
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

function buildGitSection(
  git: Awaited<ReturnType<typeof buildRunLocalContext>>["git"],
): string[] {
  const lines = [`summary: ${summarizeGit(git)}`];
  if (!git.available || !git.isRepo || !git.statusShort?.trim()) {
    return lines;
  }

  const statusLines = git.statusShort
    .trim()
    .split("\n")
    .slice(0, 3)
    .map((line) => `- ${line}`);

  lines.push(...statusLines);
  if (git.statusShort.trim().split("\n").length > statusLines.length || git.truncated) {
    lines.push(`- ... more changes`);
  }

  return lines;
}

function formatList<T>(
  items: readonly T[],
  renderItem: (item: T) => string,
  emptyLine: string,
): string[] {
  if (items.length === 0) {
    return [emptyLine];
  }

  return items.map((item) => `- ${renderItem(item)}`);
}

function flattenInspectorSections(
  sections: InspectorPanelSection[],
): string[] {
  const lines: string[] = [];

  for (const section of sections) {
    lines.push(`${section.title}:`);
    lines.push(...section.lines);
    lines.push("");
  }

  if (lines[lines.length - 1] === "") {
    lines.pop();
  }

  return lines;
}

function panelDataToHistoryItem(data: InspectorPanelData): UiHistoryItemInput {
  const lines = flattenInspectorSections(data.sections);

  switch (data.panel) {
    case "status":
      return {
        type: "status_view",
        title: "Local Status · /status",
        lines,
      };
    case "tools":
      return {
        type: "tools_view",
        title: "Local Tools · /tools",
        lines,
      };
    case "session":
      return {
        type: "session_view",
        title: "Local Session · /session",
        lines,
      };
  }
}

function formatApprovalRecord(record: PermissionRecord): string {
  const scope =
    record.scopeType === "path" && record.path
      ? record.path
      : record.scopeType === "command" && record.command
        ? record.command
        : record.target ?? record.legacyKey ?? record.scopeType;

  return `${record.toolName} ${record.decision} [${record.riskLevel}] ${scope}`;
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
