import { Box, Text } from "ink";
import type { PendingTurnState, UiHistoryItem } from "../history.js";
import type { InspectorPanelData } from "../commands.js";
import {
  buildDiffPreview,
  buildPendingTurnViewModel,
  type DiffPreviewBlockViewModel,
  type DiffPreviewLineKind,
  type PendingBashBlockViewModel,
  type PendingNoticeViewModel,
  type PendingToolCardStatus,
  type PendingToolCardViewModel,
} from "../pending-view.js";

export type InkLineTone =
  | "default"
  | "accent"
  | "dim"
  | "success"
  | "warning"
  | "error";

export interface InkLine {
  key: string;
  text: string;
  tone?: InkLineTone;
  bold?: boolean;
}

export function HistoryItemView(props: { item: UiHistoryItem }) {
  return (
    <Box flexDirection="column">
      {buildHistoryLines([props.item]).map((line) => (
        <InkLineView key={line.key} line={line} />
      ))}
    </Box>
  );
}

export function PendingTurnView(props: { pending: PendingTurnState }) {
  const lines = buildPendingLines(props.pending);
  if (lines.length === 0) {
    return null;
  }

  return (
    <Box flexDirection="column">
      {lines.map((line) => (
        <InkLineView key={line.key} line={line} />
      ))}
    </Box>
  );
}

export function InkLineView(props: { line: InkLine }) {
  return (
    <Text
      color={getToneColor(props.line.tone)}
      dimColor={props.line.tone === "dim"}
      bold={props.line.bold}
    >
      {props.line.text.length > 0 ? props.line.text : " "}
    </Text>
  );
}

export function buildHistoryLines(history: UiHistoryItem[]): InkLine[] {
  const lines: InkLine[] = [];

  for (const item of history) {
    switch (item.type) {
      case "info":
        pushBlock(lines, item.id, item.text, "dim");
        continue;
      case "user_prompt":
        pushBlock(lines, item.id, item.text, "accent", "> ");
        continue;
      case "assistant_text":
        pushBlock(lines, item.id, item.text);
        continue;
      case "reasoning":
        pushBlock(lines, item.id, item.text, "dim", "[reasoning] ");
        continue;
      case "tool_call":
        lines.push({
          key: `${item.id}:tool`,
          text: `tool: ${item.toolName}${item.target ? ` · ${item.target}` : ""}`,
          tone: "accent",
          bold: true,
        });
        if (item.argsSummary && item.argsSummary !== item.target) {
          lines.push({
            key: `${item.id}:detail`,
            text: `args: ${item.argsSummary}`,
            tone: "dim",
          });
        }
        continue;
      case "tool_result":
        lines.push({
          key: `${item.id}:result`,
          text: `[${formatStatusLabel(item.status)}] ${item.toolName}: ${item.summary}`,
          tone: getStatusTone(item.status),
          bold: true,
        });
        continue;
      case "bash_line":
        pushBlock(lines, item.id, item.text, "dim");
        continue;
      case "diff":
        const preview = buildDiffPreview(item.text, {
          path: item.path,
        });
        lines.push(...buildDiffLines(item.id, buildHistoryDiffTitle(item), {
          files: preview.files,
          hiddenFileCount: preview.hiddenFileCount,
        }));
        continue;
      case "warning":
        lines.push({
          key: `${item.id}:warning`,
          text: `warn: ${item.toolName ? `${item.toolName}: ` : ""}${item.text}`,
          tone: "warning",
        });
        continue;
      case "error":
        lines.push({
          key: `${item.id}:error`,
          text: `error: ${item.toolName ? `${item.toolName}: ` : ""}${item.text}`,
          tone: "error",
        });
        continue;
      case "status_view":
      case "tools_view":
      case "session_view":
        lines.push(...buildInspectorLinesFromSections(item.id, {
          panel: item.type === "status_view" ? "status" : item.type === "tools_view" ? "tools" : "session",
          title: item.title,
          sections: [
            {
              title: item.title,
              lines: item.lines,
            },
          ],
        }));
        continue;
    }
  }

  return lines;
}

export function buildPendingLines(pending: PendingTurnState): InkLine[] {
  if (pending.entries.length === 0) {
    return [];
  }

  const viewModel = buildPendingTurnViewModel(pending);
  const lines: InkLine[] = [];

  if (viewModel.assistant) {
    lines.push(sectionHeader("pending:assistant", "Assistant"));
    pushIndentedBlock(lines, "pending:assistant:text", viewModel.assistant.text);
    if (viewModel.assistant.hiddenChars > 0) {
      lines.push({
        key: "pending:assistant:hidden",
        text: `+${viewModel.assistant.hiddenChars} more chars`,
        tone: "dim",
      });
    }
    lines.push(blankLine("pending:assistant:gap"));
  }

  if (viewModel.reasoning) {
    lines.push(sectionHeader("pending:reasoning", "Reasoning"));
    pushIndentedBlock(lines, "pending:reasoning:text", viewModel.reasoning.text, "dim");
    if (viewModel.reasoning.hiddenChars > 0) {
      lines.push({
        key: "pending:reasoning:hidden",
        text: `+${viewModel.reasoning.hiddenChars} more chars`,
        tone: "dim",
      });
    }
    lines.push(blankLine("pending:reasoning:gap"));
  }

  if (viewModel.toolCards.length > 0) {
    lines.push(sectionHeader("pending:tools", "Tool Activity"));
    for (const card of viewModel.toolCards) {
      lines.push(...buildToolCardLines(card));
    }
    if (viewModel.hiddenToolCount > 0) {
      lines.push({
        key: "pending:tools:hidden",
        text: `+${viewModel.hiddenToolCount} earlier tool${viewModel.hiddenToolCount === 1 ? "" : "s"}`,
        tone: "dim",
      });
    }
    lines.push(blankLine("pending:tools:gap"));
  }

  if (viewModel.bashBlocks.length > 0) {
    lines.push(sectionHeader("pending:bash", "Bash Tail"));
    for (const block of viewModel.bashBlocks) {
      lines.push(...buildBashBlockLines(block));
    }
    if (viewModel.hiddenBashBlockCount > 0) {
      lines.push({
        key: "pending:bash:hidden",
        text: `+${viewModel.hiddenBashBlockCount} older bash block${viewModel.hiddenBashBlockCount === 1 ? "" : "s"}`,
        tone: "dim",
      });
    }
    lines.push(blankLine("pending:bash:gap"));
  }

  if (viewModel.diffBlocks.length > 0) {
    lines.push(sectionHeader("pending:diff", "Diff Preview"));
    for (const block of viewModel.diffBlocks) {
      lines.push(...buildDiffLines(block.key, block.title, block));
    }
    if (viewModel.hiddenDiffBlockCount > 0) {
      lines.push({
        key: "pending:diff:hidden",
        text: `+${viewModel.hiddenDiffBlockCount} older diff block${viewModel.hiddenDiffBlockCount === 1 ? "" : "s"}`,
        tone: "dim",
      });
    }
    lines.push(blankLine("pending:diff:gap"));
  }

  if (viewModel.warnings.length > 0 || viewModel.errors.length > 0) {
    lines.push(sectionHeader("pending:notices", "Warnings / Errors"));
    for (const warning of viewModel.warnings) {
      lines.push(buildNoticeLine(warning, "warning"));
    }
    if (viewModel.hiddenWarningCount > 0) {
      lines.push({
        key: "pending:notices:hidden:warnings",
        text: `+${viewModel.hiddenWarningCount} more warning${viewModel.hiddenWarningCount === 1 ? "" : "s"}`,
        tone: "dim",
      });
    }
    for (const error of viewModel.errors) {
      lines.push(buildNoticeLine(error, "error"));
    }
    if (viewModel.hiddenErrorCount > 0) {
      lines.push({
        key: "pending:notices:hidden:errors",
        text: `+${viewModel.hiddenErrorCount} more error${viewModel.hiddenErrorCount === 1 ? "" : "s"}`,
        tone: "dim",
      });
    }
  }

  while (lines.at(-1)?.text === "") {
    lines.pop();
  }

  return lines;
}

export function buildInspectorLines(data: InspectorPanelData): InkLine[] {
  return buildInspectorLinesFromSections(data.panel, data);
}

export function wrapInkLines(lines: InkLine[], width: number): InkLine[] {
  const resolvedWidth = Math.max(1, width);
  const wrapped: InkLine[] = [];

  for (const line of lines) {
    const normalizedRows = line.text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
    for (const [rowIndex, row] of normalizedRows.entries()) {
      const graphemes = Array.from(row.replace(/\t/g, "    "));
      if (graphemes.length === 0) {
        wrapped.push({
          ...line,
          key: `${line.key}:row:${rowIndex}:0`,
          text: "",
        });
        continue;
      }

      for (let offset = 0; offset < graphemes.length; offset += resolvedWidth) {
        wrapped.push({
          ...line,
          key: `${line.key}:row:${rowIndex}:${offset}`,
          text: graphemes.slice(offset, offset + resolvedWidth).join(""),
        });
      }
    }
  }

  return wrapped;
}

function buildInspectorLinesFromSections(
  keyPrefix: string,
  data: InspectorPanelData,
): InkLine[] {
  const lines: InkLine[] = [
    {
      key: `${keyPrefix}:title`,
      text: data.title,
      tone: "accent",
      bold: true,
    },
  ];

  for (const [index, section] of data.sections.entries()) {
    lines.push(blankLine(`${keyPrefix}:gap:${index}`));
    lines.push(sectionHeader(`${keyPrefix}:section:${index}`, section.title));
    for (const [lineIndex, line] of section.lines.entries()) {
      lines.push({
        key: `${keyPrefix}:section:${index}:line:${lineIndex}`,
        text: line,
      });
    }
  }

  return lines;
}

function buildToolCardLines(card: PendingToolCardViewModel): InkLine[] {
  const lines: InkLine[] = [
    {
      key: `${card.key}:title`,
      text: `[${formatStatusLabel(card.status)}] ${card.toolName}${card.target ? ` · ${card.target}` : ""}`,
      tone: getStatusTone(card.status),
      bold: true,
    },
  ];

  if (card.detail) {
    lines.push({
      key: `${card.key}:detail`,
      text: `detail: ${card.detail}`,
      tone: "dim",
    });
  }
  if (card.summary) {
    lines.push({
      key: `${card.key}:summary`,
      text: `summary: ${card.summary}`,
    });
  }
  if (card.activity) {
    lines.push({
      key: `${card.key}:activity`,
      text: `activity: ${card.activity}`,
      tone: "dim",
    });
  }
  lines.push(blankLine(`${card.key}:gap`));
  return lines;
}

function buildBashBlockLines(block: PendingBashBlockViewModel): InkLine[] {
  const lines: InkLine[] = [
    {
      key: `${block.key}:title`,
      text: `[${formatStatusLabel(block.status)}] ${block.title}`,
      tone: getStatusTone(block.status),
      bold: true,
    },
  ];

  if (block.summary) {
    lines.push({
      key: `${block.key}:summary`,
      text: `summary: ${block.summary}`,
      tone: "dim",
    });
  }

  for (const [index, line] of block.lines.entries()) {
    lines.push({
      key: `${block.key}:line:${index}`,
      text: `  ${line}`,
      tone: "dim",
    });
  }

  if (block.hiddenLineCount > 0) {
    lines.push({
      key: `${block.key}:hidden`,
      text: `  +${block.hiddenLineCount} more`,
      tone: "dim",
    });
  }

  lines.push(blankLine(`${block.key}:gap`));
  return lines;
}

function buildDiffLines(
  keyPrefix: string,
  title: string,
  block: Pick<DiffPreviewBlockViewModel, "files" | "hiddenFileCount" | "summary">,
): InkLine[] {
  const lines: InkLine[] = [
    {
      key: `${keyPrefix}:title`,
      text: title,
      tone: "accent",
      bold: true,
    },
  ];

  if (block.summary) {
    lines.push({
      key: `${keyPrefix}:summary`,
      text: `summary: ${block.summary}`,
      tone: "dim",
    });
  }

  for (const [fileIndex, file] of block.files.entries()) {
    lines.push({
      key: `${keyPrefix}:file:${fileIndex}`,
      text: file.path,
      tone: "accent",
    });
    for (const [lineIndex, line] of file.lines.entries()) {
      lines.push({
        key: `${keyPrefix}:file:${fileIndex}:line:${lineIndex}`,
        text: `  ${line.text}`,
        tone: getDiffTone(line.kind),
      });
    }
    if (file.hiddenLineCount > 0) {
      lines.push({
        key: `${keyPrefix}:file:${fileIndex}:hidden`,
        text: `  +${file.hiddenLineCount} more lines`,
        tone: "dim",
      });
    }
  }

  if (block.hiddenFileCount > 0) {
    lines.push({
      key: `${keyPrefix}:hidden-files`,
      text: `+${block.hiddenFileCount} more file${block.hiddenFileCount === 1 ? "" : "s"}`,
      tone: "dim",
    });
  }

  lines.push(blankLine(`${keyPrefix}:gap`));
  return lines;
}

function buildNoticeLine(
  notice: PendingNoticeViewModel,
  level: "warning" | "error",
): InkLine {
  return {
    key: `${notice.key}:${level}`,
    text: `${level === "warning" ? "warn" : "error"}: ${notice.toolName ? `${notice.toolName}: ` : ""}${notice.message}`,
    tone: level,
  };
}

function buildHistoryDiffTitle(
  item: Extract<UiHistoryItem, { type: "diff" }>,
): string {
  const titleParts = ["Diff"];
  if (item.toolName) {
    titleParts.push(item.toolName);
  }
  if (item.path) {
    titleParts.push(item.path);
  }
  return titleParts.join(" · ");
}

function pushBlock(
  lines: InkLine[],
  keyPrefix: string,
  text: string,
  tone: InkLineTone = "default",
  prefix = "",
): void {
  const rows = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  rows.forEach((row, index) => {
    lines.push({
      key: `${keyPrefix}:${index}`,
      text: `${index === 0 ? prefix : ""}${row}`,
      tone,
    });
  });
}

function pushIndentedBlock(
  lines: InkLine[],
  keyPrefix: string,
  text: string,
  tone: InkLineTone = "default",
): void {
  const rows = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  rows.forEach((row, index) => {
    lines.push({
      key: `${keyPrefix}:${index}`,
      text: `  ${row}`,
      tone,
    });
  });
}

function blankLine(key: string): InkLine {
  return {
    key,
    text: "",
  };
}

function sectionHeader(key: string, title: string): InkLine {
  return {
    key,
    text: title,
    tone: "accent",
    bold: true,
  };
}

function getStatusTone(status: PendingToolCardStatus): InkLineTone {
  switch (status) {
    case "success":
      return "success";
    case "denied":
      return "warning";
    case "error":
      return "error";
    case "waiting_permission":
      return "warning";
    default:
      return "accent";
  }
}

function formatStatusLabel(status: PendingToolCardStatus): string {
  switch (status) {
    case "waiting_permission":
      return "approval";
    default:
      return status;
  }
}

function getToneColor(
  tone: InkLineTone | undefined,
): "cyan" | "green" | "yellow" | "red" | undefined {
  switch (tone) {
    case "accent":
      return "cyan";
    case "success":
      return "green";
    case "warning":
      return "yellow";
    case "error":
      return "red";
    default:
      return undefined;
  }
}

function getDiffTone(kind: DiffPreviewLineKind): InkLineTone {
  switch (kind) {
    case "add":
      return "success";
    case "remove":
      return "error";
    case "hunk":
      return "warning";
    case "note":
      return "dim";
    default:
      return "default";
  }
}
