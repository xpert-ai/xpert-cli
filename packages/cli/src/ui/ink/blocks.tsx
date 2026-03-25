import { Box, Text } from "ink";
import type {
  UiBashOutputBlock,
  UiDiffPreviewBlock,
  UiNoticeBlock,
  UiRenderBlock,
  UiSectionBlock,
  UiToolGroupBlock,
} from "../render-blocks.js";
import {
  stripAnsi,
  stringDisplayWidth,
  takeHeadDisplayWidthChunk,
  truncateDisplayWidth,
  wrapDisplayWidth,
} from "../display-width.js";

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
  prefix?: string;
  continuationPrefix?: string;
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
        toBodyRows(block.id, block.text, {
          tone: "dim",
          prefix: "· ",
          continuationPrefix: "  ",
        }),
        block.id,
      );
    case "user_message":
      return withGap(
        [
          {
            key: `${block.id}:title`,
            text: block.pending ? "Prompt · live" : "Prompt",
            tone: "accent",
            bold: true,
          },
          ...toBodyRows(`${block.id}:body`, block.text),
        ],
        block.id,
      );
    case "assistant_message":
      return withGap(
        [
          titleRow(block.id, block.pending ? "Assistant · live" : "Assistant"),
          ...toBodyRows(`${block.id}:body`, block.text),
        ],
        block.id,
      );
    case "thinking":
      return withGap(
        [
          titleRow(
            block.id,
            block.pending ? "Thinking · live" : "Thinking",
            "dim",
          ),
          ...toBodyRows(`${block.id}:body`, block.text, {
            tone: "dim",
          }),
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
      text: [
        "Tool",
        block.toolName,
        block.target,
        formatStatus(block.status),
        block.pending ? "live" : undefined,
      ]
        .filter((part): part is string => Boolean(part))
        .join(" · "),
      tone: getStatusTone(block.status),
      bold: true,
    },
  ];

  if (block.detail) {
    rows.push(metaRow(`${block.id}:detail`, "args", block.detail, "dim"));
  }
  if (block.summary) {
    rows.push(metaRow(`${block.id}:summary`, "result", block.summary));
  }
  if (block.activity) {
    rows.push(metaRow(`${block.id}:activity`, "activity", block.activity, "dim"));
  }

  return rows;
}

function buildBashRows(block: UiBashOutputBlock): TextRow[] {
  const rows: TextRow[] = [
    {
      key: `${block.id}:title`,
      text: [
        "Log",
        block.title,
        formatStatus(block.status),
        block.pending ? "live" : undefined,
      ]
        .filter((part): part is string => Boolean(part))
        .join(" · "),
      tone: getStatusTone(block.status),
      bold: true,
    },
  ];

  if (block.summary) {
    rows.push(metaRow(`${block.id}:summary`, "result", block.summary, "dim"));
  }

  block.lines.forEach((line, index) => {
    rows.push({
      key: `${block.id}:line:${index}`,
      text: line,
      prefix: "│ ",
      continuationPrefix: "│ ",
      tone: "dim",
    });
  });

  if (block.hiddenLineCount > 0) {
    rows.push(
      metaRow(
        `${block.id}:hidden`,
        "more",
        `+${block.hiddenLineCount} line${block.hiddenLineCount === 1 ? "" : "s"}`,
        "dim",
      ),
    );
  }

  return rows;
}

function buildDiffRows(block: UiDiffPreviewBlock): TextRow[] {
  const rows: TextRow[] = [
    {
      key: `${block.id}:title`,
      text: [
        "Diff",
        block.title,
        block.status ? formatStatus(block.status) : undefined,
        block.pending ? "live" : undefined,
      ]
        .filter((part): part is string => Boolean(part))
        .join(" · "),
      tone: block.status ? getStatusTone(block.status) : "accent",
      bold: true,
    },
  ];

  if (block.summary) {
    rows.push(metaRow(`${block.id}:summary`, "files", block.summary, "dim"));
  }

  block.files.forEach((file, fileIndex) => {
    rows.push(metaRow(`${block.id}:file:${fileIndex}`, "file", file.path, "accent"));
    file.lines.forEach((line, lineIndex) => {
      rows.push({
        key: `${block.id}:file:${fileIndex}:line:${lineIndex}`,
        text: line.text,
        prefix: "│ ",
        continuationPrefix: "│ ",
        tone: getDiffTone(line.kind),
      });
    });
    if (file.hiddenLineCount > 0) {
      rows.push(
        metaRow(
          `${block.id}:file:${fileIndex}:hidden`,
          "more",
          `+${file.hiddenLineCount} line${file.hiddenLineCount === 1 ? "" : "s"}`,
          "dim",
        ),
      );
    }
  });

  if (block.hiddenFileCount > 0) {
    rows.push(
      metaRow(
        `${block.id}:hidden`,
        "more",
        `+${block.hiddenFileCount} file${block.hiddenFileCount === 1 ? "" : "s"}`,
        "dim",
      ),
    );
  }

  return rows;
}

function buildNoticeRows(block: UiNoticeBlock): TextRow[] {
  const tone =
    block.level === "error"
      ? "error"
      : block.level === "warning"
        ? "warning"
        : "accent";
  const rows: TextRow[] = [
    {
      key: `${block.id}:title`,
      text: [block.title, block.code ? `[${block.code}]` : undefined, block.pending ? "live" : undefined]
        .filter((part): part is string => Boolean(part))
        .join(" · "),
      tone,
      bold: true,
    },
  ];

  block.messages.forEach((message, index) => {
    rows.push({
      key: `${block.id}:message:${index}`,
      text: message,
      prefix: "│ ",
      continuationPrefix: "│ ",
      tone: block.level === "info" ? "default" : tone,
    });
  });

  return rows;
}

function buildSectionRows(block: UiSectionBlock): TextRow[] {
  const rows: TextRow[] = [titleRow(block.id, block.title)];

  block.lines.forEach((line, index) => {
    if (line.length === 0) {
      rows.push({
        key: `${block.id}:line:${index}`,
        text: "",
      });
      return;
    }

    if (isSectionHeading(line)) {
      rows.push({
        key: `${block.id}:line:${index}`,
        text: line.slice(0, -1),
        tone: "accent",
        bold: true,
      });
      return;
    }

    rows.push({
      key: `${block.id}:line:${index}`,
      text: line,
      prefix: "│ ",
      continuationPrefix: "│ ",
    });
  });

  return rows;
}

function titleRow(
  keyPrefix: string,
  text: string,
  tone: TextRowTone = "accent",
): TextRow {
  return {
    key: `${keyPrefix}:title`,
    text,
    tone,
    bold: true,
  };
}

function toBodyRows(
  keyPrefix: string,
  text: string,
  options: {
    tone?: TextRowTone;
    bold?: boolean;
    prefix?: string;
    continuationPrefix?: string;
  } = {},
): TextRow[] {
  return normalizeLines(text).map((line, index) => ({
    key: `${keyPrefix}:${index}`,
    text: line,
    tone: options.tone,
    bold: options.bold,
    prefix: options.prefix ?? "│ ",
    continuationPrefix: options.continuationPrefix ?? options.prefix ?? "│ ",
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
    const prefix = row.prefix?.replace(/\t/g, "    ");
    const continuationPrefix =
      row.continuationPrefix?.replace(/\t/g, "    ") ?? prefix;

    for (const [rowIndex, normalizedRow] of normalizedRows.entries()) {
      const segments = wrapPrefixedText(
        normalizedRow,
        resolvedWidth,
        prefix,
        continuationPrefix,
      );
      for (const [segmentIndex, segment] of segments.entries()) {
        wrapped.push({
          ...row,
          key: `${row.key}:row:${rowIndex}:${segmentIndex}`,
          text: segment,
          prefix: undefined,
          continuationPrefix: undefined,
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
    case "idle":
      return "idle";
    case "waiting_permission":
      return "waiting";
    default:
      return status;
  }
}

function metaRow(
  key: string,
  label: string,
  value: string,
  tone: TextRowTone = "default",
): TextRow {
  const normalizedLabel = `${label}:`.padEnd(10, " ");
  return {
    key,
    text: value,
    tone,
    prefix: `│ ${normalizedLabel}`,
    continuationPrefix: `│ ${" ".repeat(normalizedLabel.length)}`,
  };
}

function wrapPrefixedText(
  text: string,
  width: number,
  prefix?: string,
  continuationPrefix?: string,
): string[] {
  if (!prefix) {
    const segments = wrapDisplayWidth(text, width);
    return segments.length > 0 ? segments : [""];
  }

  const visibleText = stripAnsi(text);

  const prefixWidth = stringDisplayWidth(prefix);
  if (prefixWidth >= width) {
    return [truncateDisplayWidth(prefix.trimEnd() || prefix, width)];
  }

  if (visibleText.length === 0) {
    return [prefix.trimEnd()];
  }

  const firstAvailableWidth = Math.max(1, width - prefixWidth);
  const {
    segment: firstSegment,
    consumedLength: firstConsumedLength,
  } = takeHeadDisplayWidthChunk(visibleText, firstAvailableWidth);
  const rows = [`${prefix}${firstSegment}`];
  let remaining = visibleText.slice(firstConsumedLength);

  if (remaining.length === 0) {
    return rows;
  }

  const nextPrefix = continuationPrefix ?? prefix;
  const nextPrefixWidth = stringDisplayWidth(nextPrefix);
  if (nextPrefixWidth >= width) {
    rows.push(truncateDisplayWidth(nextPrefix.trimEnd() || nextPrefix, width));
    return rows;
  }

  const continuationWidth = Math.max(1, width - nextPrefixWidth);
  while (remaining.length > 0) {
    const { segment, consumedLength } = takeHeadDisplayWidthChunk(
      remaining,
      continuationWidth,
    );
    if (consumedLength <= 0) {
      break;
    }
    rows.push(`${nextPrefix}${segment}`);
    remaining = remaining.slice(consumedLength);
  }

  return rows;
}

function isSectionHeading(value: string): boolean {
  return !value.startsWith(" ") && value.endsWith(":");
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
