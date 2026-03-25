import { Box, Text } from "ink";
import type {
  UiBashOutputBlock,
  UiDiffPreviewBlock,
  UiNoticeBlock,
  UiRenderBlock,
  UiSectionBlock,
  UiToolGroupBlock,
} from "../render-blocks.js";

export type TextRowTone =
  | "default"
  | "accent"
  | "dim"
  | "success"
  | "warning"
  | "error";

export interface TextRow {
  key: string;
  text: string;
  tone?: TextRowTone;
  bold?: boolean;
}

export function BlockView(props: {
  block: UiRenderBlock;
  width: number;
  visibleStart?: number;
  visibleEnd?: number;
}) {
  const rows = renderBlockRows(props.block, props.width);
  const visibleRows = rows.slice(
    props.visibleStart ?? 0,
    props.visibleEnd ?? rows.length,
  );

  if (visibleRows.length === 0) {
    return null;
  }

  return (
    <Box flexDirection="column" width={props.width} overflow="hidden">
      <TextRowsView rows={visibleRows} />
    </Box>
  );
}

export function TextRowsView(props: {
  rows: TextRow[];
}) {
  return (
    <>
      {props.rows.map((row) => (
        <Text
          key={row.key}
          color={getToneColor(row.tone)}
          dimColor={row.tone === "dim"}
          bold={row.bold}
        >
          {row.text.length > 0 ? row.text : " "}
        </Text>
      ))}
    </>
  );
}

export function measureRenderBlock(block: UiRenderBlock, width: number): number {
  return renderBlockRows(block, width).length;
}

export function renderBlockRows(block: UiRenderBlock, width: number): TextRow[] {
  return wrapTextRows(buildBlockRows(block), width);
}

function buildBlockRows(block: UiRenderBlock): TextRow[] {
  switch (block.kind) {
    case "info":
      return withGap(
        toTextRows(block.id, block.text, {
          tone: "dim",
        }),
        block.id,
      );
    case "user_message":
      return withGap(
        [
          {
            key: `${block.id}:title`,
            text: block.pending ? "You · live" : "You",
            tone: "accent",
            bold: true,
          },
          ...toIndentedRows(`${block.id}:body`, block.text),
        ],
        block.id,
      );
    case "assistant_message":
      return withGap(
        [
          titleRow(block.id, block.pending ? "Assistant · live" : "Assistant"),
          ...toIndentedRows(`${block.id}:body`, block.text),
        ],
        block.id,
      );
    case "thinking":
      return withGap(
        [
          titleRow(block.id, block.pending ? "Thinking · live" : "Thinking"),
          ...toIndentedRows(`${block.id}:body`, block.text, "dim"),
        ],
        block.id,
      );
    case "tool_group":
      return withGap(buildToolGroupRows(block), block.id);
    case "bash_output":
      return withGap(buildBashRows(block), block.id);
    case "diff_preview":
      return withGap(buildDiffRows(block), block.id);
    case "notice":
      return withGap(buildNoticeRows(block), block.id);
    case "section":
      return withGap(buildSectionRows(block), block.id);
  }
}

function buildToolGroupRows(block: UiToolGroupBlock): TextRow[] {
  const rows: TextRow[] = [
    {
      key: `${block.id}:title`,
      text: `[${formatStatus(block.status)}] ${block.toolName}${block.target ? ` · ${block.target}` : ""}${block.pending ? " · live" : ""}`,
      tone: getStatusTone(block.status),
      bold: true,
    },
  ];

  if (block.detail) {
    rows.push({
      key: `${block.id}:detail`,
      text: `  args: ${block.detail}`,
      tone: "dim",
    });
  }
  if (block.summary) {
    rows.push({
      key: `${block.id}:summary`,
      text: `  summary: ${block.summary}`,
    });
  }
  if (block.activity) {
    rows.push({
      key: `${block.id}:activity`,
      text: `  activity: ${block.activity}`,
      tone: "dim",
    });
  }

  return rows;
}

function buildBashRows(block: UiBashOutputBlock): TextRow[] {
  const rows: TextRow[] = [
    {
      key: `${block.id}:title`,
      text: `[${formatStatus(block.status)}] ${block.title}${block.pending ? " · live" : ""}`,
      tone: getStatusTone(block.status),
      bold: true,
    },
  ];

  if (block.summary) {
    rows.push({
      key: `${block.id}:summary`,
      text: `  summary: ${block.summary}`,
      tone: "dim",
    });
  }

  block.lines.forEach((line, index) => {
    rows.push({
      key: `${block.id}:line:${index}`,
      text: `  ${line}`,
      tone: "dim",
    });
  });

  if (block.hiddenLineCount > 0) {
    rows.push({
      key: `${block.id}:hidden`,
      text: `  +${block.hiddenLineCount} more line${block.hiddenLineCount === 1 ? "" : "s"}`,
      tone: "dim",
    });
  }

  return rows;
}

function buildDiffRows(block: UiDiffPreviewBlock): TextRow[] {
  const rows: TextRow[] = [
    {
      key: `${block.id}:title`,
      text: `${block.status ? `[${formatStatus(block.status)}] ` : ""}${block.title}${block.pending ? " · live" : ""}`,
      tone: block.status ? getStatusTone(block.status) : "accent",
      bold: true,
    },
  ];

  if (block.summary) {
    rows.push({
      key: `${block.id}:summary`,
      text: `  summary: ${block.summary}`,
      tone: "dim",
    });
  }

  block.files.forEach((file, fileIndex) => {
    rows.push({
      key: `${block.id}:file:${fileIndex}`,
      text: `  ${file.path}`,
      tone: "accent",
    });
    file.lines.forEach((line, lineIndex) => {
      rows.push({
        key: `${block.id}:file:${fileIndex}:line:${lineIndex}`,
        text: `    ${line.text}`,
        tone: getDiffTone(line.kind),
      });
    });
    if (file.hiddenLineCount > 0) {
      rows.push({
        key: `${block.id}:file:${fileIndex}:hidden`,
        text: `    +${file.hiddenLineCount} more line${file.hiddenLineCount === 1 ? "" : "s"}`,
        tone: "dim",
      });
    }
  });

  if (block.hiddenFileCount > 0) {
    rows.push({
      key: `${block.id}:hidden`,
      text: `  +${block.hiddenFileCount} more file${block.hiddenFileCount === 1 ? "" : "s"}`,
      tone: "dim",
    });
  }

  return rows;
}

function buildNoticeRows(block: UiNoticeBlock): TextRow[] {
  const rows: TextRow[] = [
    {
      key: `${block.id}:title`,
      text: `${block.title}${block.pending ? " · live" : ""}`,
      tone:
        block.level === "error"
          ? "error"
          : block.level === "warning"
            ? "warning"
            : "accent",
      bold: true,
    },
  ];

  block.messages.forEach((message, index) => {
    rows.push({
      key: `${block.id}:message:${index}`,
      text: `  ${message}`,
      tone:
        block.level === "error"
          ? "error"
          : block.level === "warning"
            ? "warning"
            : "default",
    });
  });

  rows.push({
    key: `${block.id}:scope`,
    text: `  scope: ${block.scope}`,
    tone: "dim",
  });

  return rows;
}

function buildSectionRows(block: UiSectionBlock): TextRow[] {
  const rows: TextRow[] = [titleRow(block.id, block.title)];

  block.lines.forEach((line, index) => {
    rows.push({
      key: `${block.id}:line:${index}`,
      text: line,
    });
  });

  return rows;
}

function titleRow(keyPrefix: string, text: string): TextRow {
  return {
    key: `${keyPrefix}:title`,
    text,
    tone: "accent",
    bold: true,
  };
}

function toTextRows(
  keyPrefix: string,
  text: string,
  options: {
    tone?: TextRowTone;
    bold?: boolean;
  } = {},
): TextRow[] {
  return normalizeLines(text).map((line, index) => ({
    key: `${keyPrefix}:${index}`,
    text: line,
    tone: options.tone,
    bold: options.bold,
  }));
}

function toIndentedRows(
  keyPrefix: string,
  text: string,
  tone: TextRowTone = "default",
): TextRow[] {
  return normalizeLines(text).map((line, index) => ({
    key: `${keyPrefix}:${index}`,
    text: `  ${line}`,
    tone,
  }));
}

function withGap(rows: TextRow[], keyPrefix: string): TextRow[] {
  return [
    ...rows,
    {
      key: `${keyPrefix}:gap`,
      text: "",
    },
  ];
}

function wrapTextRows(rows: TextRow[], width: number): TextRow[] {
  const resolvedWidth = Math.max(1, width);
  const wrapped: TextRow[] = [];

  for (const row of rows) {
    const normalizedRows = normalizeLines(row.text.replace(/\t/g, "    "));

    for (const [rowIndex, normalizedRow] of normalizedRows.entries()) {
      const chars = Array.from(normalizedRow);
      if (chars.length === 0) {
        wrapped.push({
          ...row,
          key: `${row.key}:row:${rowIndex}:0`,
          text: "",
        });
        continue;
      }

      for (let offset = 0; offset < chars.length; offset += resolvedWidth) {
        wrapped.push({
          ...row,
          key: `${row.key}:row:${rowIndex}:${offset}`,
          text: chars.slice(offset, offset + resolvedWidth).join(""),
        });
      }
    }
  }

  return wrapped;
}

function normalizeLines(value: string): string[] {
  return value.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
}

function formatStatus(status: UiToolGroupBlock["status"]): string {
  switch (status) {
    case "waiting_permission":
      return "waiting";
    default:
      return status;
  }
}

function getStatusTone(status: UiToolGroupBlock["status"]): TextRowTone {
  switch (status) {
    case "success":
      return "success";
    case "error":
    case "denied":
      return "error";
    case "waiting_permission":
      return "warning";
    default:
      return "accent";
  }
}

function getDiffTone(
  kind: UiDiffPreviewBlock["files"][number]["lines"][number]["kind"],
): TextRowTone {
  switch (kind) {
    case "add":
      return "success";
    case "remove":
      return "error";
    case "hunk":
      return "accent";
    default:
      return "dim";
  }
}

function getToneColor(
  tone: TextRowTone | undefined,
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
