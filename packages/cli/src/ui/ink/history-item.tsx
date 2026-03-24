import { Box, Text } from "ink";
import type { ReactNode } from "react";
import type { PendingTurnState, UiHistoryItem } from "../history.js";
import {
  buildDiffPreview,
  buildPendingTurnViewModel,
  type DiffPreviewBlockViewModel,
  type DiffPreviewLineViewModel,
  type PendingBashBlockViewModel,
  type PendingNoticeViewModel,
  type PendingToolCardStatus,
  type PendingToolCardViewModel,
  type TextPreview,
} from "../pending-view.js";

export function HistoryItemView(props: { item: UiHistoryItem }) {
  return renderEntry(props.item);
}

export function PendingTurnView(props: { pending: PendingTurnState }) {
  if (props.pending.entries.length === 0) {
    return null;
  }

  const viewModel = buildPendingTurnViewModel(props.pending);
  const hasNotices = viewModel.warnings.length > 0 || viewModel.errors.length > 0;

  return (
    <Box flexDirection="column" marginTop={1}>
      <Text bold color="cyan">
        Current turn
      </Text>
      {viewModel.assistant ? (
        <Section title="Assistant">
          <TextBlock preview={viewModel.assistant} />
        </Section>
      ) : null}
      {viewModel.reasoning ? (
        <Section title="Reasoning">
          <TextBlock preview={viewModel.reasoning} dimColor />
        </Section>
      ) : null}
      {viewModel.toolCards.length > 0 ? (
        <Section
          title="Tool activity"
          suffix={formatOverflowNotice(viewModel.hiddenToolCount, "earlier tool")}
        >
          {viewModel.toolCards.map((toolCard) => (
            <ToolCardView key={toolCard.key} card={toolCard} />
          ))}
        </Section>
      ) : null}
      {viewModel.bashBlocks.length > 0 ? (
        <Section
          title="Bash tail"
          suffix={formatOverflowNotice(viewModel.hiddenBashBlockCount, "older block")}
        >
          {viewModel.bashBlocks.map((block) => (
            <BashBlockView key={block.key} block={block} />
          ))}
        </Section>
      ) : null}
      {viewModel.diffBlocks.length > 0 ? (
        <Section
          title="Diff preview"
          suffix={formatOverflowNotice(viewModel.hiddenDiffBlockCount, "older block")}
        >
          {viewModel.diffBlocks.map((block) => (
            <DiffBlockView key={block.key} block={block} />
          ))}
        </Section>
      ) : null}
      {hasNotices ? (
        <Section title="Warnings / errors">
          {viewModel.warnings.map((notice) => (
            <NoticeLine key={notice.key} notice={notice} level="warning" />
          ))}
          {viewModel.hiddenWarningCount > 0 ? (
            <OverflowLine
              count={viewModel.hiddenWarningCount}
              noun="more warning"
            />
          ) : null}
          {viewModel.errors.map((notice) => (
            <NoticeLine key={notice.key} notice={notice} level="error" />
          ))}
          {viewModel.hiddenErrorCount > 0 ? (
            <OverflowLine
              count={viewModel.hiddenErrorCount}
              noun="more error"
            />
          ) : null}
        </Section>
      ) : null}
    </Box>
  );
}

function renderEntry(item: UiHistoryItem) {
  switch (item.type) {
    case "info":
      return <Text dimColor>{item.text}</Text>;
    case "user_prompt":
      return (
        <Text color="cyan">
          &gt; {item.text}
        </Text>
      );
    case "assistant_text":
      return <Text>{item.text}</Text>;
    case "reasoning":
      return <Text dimColor>[reasoning] {item.text}</Text>;
    case "tool_call":
      return (
        <Text>
          <Text color="cyan">tool</Text>
          <Text dimColor>: </Text>
          <Text bold>{item.toolName}</Text>
          {item.target ? <Text dimColor> · {item.target}</Text> : null}
        </Text>
      );
    case "tool_result":
      return (
        <Text color={getStatusColor(item.status)}>
          {formatStatusLabel(item.status)} {item.toolName}: {item.summary}
        </Text>
      );
    case "bash_line":
      return <Text dimColor>{item.text}</Text>;
    case "diff": {
      const preview = buildDiffPreview(item.text, {
        path: item.path,
      });
      return (
        <DiffBlockView
          block={{
            key: item.id,
            title: buildHistoryDiffTitle(item),
            summary: undefined,
            files: preview.files,
            hiddenFileCount: preview.hiddenFileCount,
          }}
        />
      );
    }
    case "warning":
      return <NoticeLine notice={item} level="warning" />;
    case "error":
      return <NoticeLine notice={item} level="error" />;
    case "status_view":
    case "tools_view":
    case "session_view":
      return (
        <Box flexDirection="column" marginBottom={1}>
          <Text bold>{item.title}</Text>
          <Text>{item.lines.join("\n")}</Text>
        </Box>
      );
  }
}

function Section(props: {
  title: string;
  suffix?: string;
  children: ReactNode;
}) {
  return (
    <Box flexDirection="column" marginTop={1}>
      <Text bold>
        {props.title}
        {props.suffix ? <Text dimColor> {props.suffix}</Text> : null}
      </Text>
      <Box flexDirection="column" marginLeft={2}>
        {props.children}
      </Box>
    </Box>
  );
}

function ToolCardView(props: { card: PendingToolCardViewModel }) {
  return (
    <Box flexDirection="column" marginBottom={1}>
      <Text>
        <Text color={getStatusColor(props.card.status)}>
          [{formatStatusLabel(props.card.status)}]
        </Text>
        <Text> </Text>
        <Text bold>{props.card.toolName}</Text>
        {props.card.target ? <Text dimColor> · {props.card.target}</Text> : null}
      </Text>
      {props.card.detail ? <Text dimColor>{props.card.detail}</Text> : null}
      {props.card.summary ? <Text>{props.card.summary}</Text> : null}
      {props.card.activity ? <Text dimColor>{props.card.activity}</Text> : null}
    </Box>
  );
}

function BashBlockView(props: { block: PendingBashBlockViewModel }) {
  return (
    <Box flexDirection="column" marginBottom={1}>
      <Text>
        <Text color={getStatusColor(props.block.status)}>
          [{formatStatusLabel(props.block.status)}]
        </Text>
        <Text> </Text>
        <Text bold>{props.block.title}</Text>
      </Text>
      {props.block.summary ? <Text dimColor>{props.block.summary}</Text> : null}
      <Box flexDirection="column" marginLeft={2}>
        {props.block.lines.map((line, index) => (
          <Text key={`${props.block.key}:line:${index}`} dimColor>
            {line}
          </Text>
        ))}
        {props.block.hiddenLineCount > 0 ? (
          <OverflowLine count={props.block.hiddenLineCount} noun="more bash line" />
        ) : null}
      </Box>
    </Box>
  );
}

function DiffBlockView(props: { block: DiffPreviewBlockViewModel }) {
  return (
    <Box flexDirection="column" marginBottom={1}>
      <Text>
        {props.block.status ? (
          <>
            <Text color={getStatusColor(props.block.status)}>
              [{formatStatusLabel(props.block.status)}]
            </Text>
            <Text> </Text>
          </>
        ) : null}
        <Text bold>{props.block.title}</Text>
      </Text>
      {props.block.summary ? <Text dimColor>{props.block.summary}</Text> : null}
      <Box flexDirection="column" marginLeft={2}>
        {props.block.files.map((file, index) => (
          <Box key={`${props.block.key}:file:${index}`} flexDirection="column" marginBottom={1}>
            <Text color="cyan">{file.path}</Text>
            <Box flexDirection="column" marginLeft={2}>
              {file.lines.map((line, lineIndex) => (
                <DiffLineView
                  key={`${props.block.key}:file:${index}:line:${lineIndex}`}
                  line={line}
                />
              ))}
              {file.hiddenLineCount > 0 ? (
                <OverflowLine count={file.hiddenLineCount} noun="more diff line" />
              ) : null}
            </Box>
          </Box>
        ))}
        {props.block.hiddenFileCount > 0 ? (
          <OverflowLine count={props.block.hiddenFileCount} noun="more file" />
        ) : null}
      </Box>
    </Box>
  );
}

function DiffLineView(props: { line: DiffPreviewLineViewModel }) {
  switch (props.line.kind) {
    case "add":
      return <Text color="green">{props.line.text}</Text>;
    case "remove":
      return <Text color="red">{props.line.text}</Text>;
    case "hunk":
      return <Text color="yellow">{props.line.text}</Text>;
    case "note":
      return <Text dimColor>{props.line.text}</Text>;
    case "context":
      return <Text>{props.line.text}</Text>;
  }
}

function NoticeLine(props: {
  notice:
    | Pick<PendingNoticeViewModel, "message" | "toolName">
    | {
        toolName?: string;
        text: string;
      };
  level: "warning" | "error";
}) {
  const prefix = props.level === "warning" ? "warn" : "error";
  const message = "message" in props.notice ? props.notice.message : props.notice.text;
  return (
    <Text color={props.level === "warning" ? "yellow" : "red"}>
      {prefix}: {props.notice.toolName ? `${props.notice.toolName}: ` : ""}
      {message}
    </Text>
  );
}

function TextBlock(props: {
  preview: TextPreview;
  dimColor?: boolean;
}) {
  return (
    <Box flexDirection="column">
      <Text dimColor={props.dimColor}>{props.preview.text}</Text>
      {props.preview.hiddenChars > 0 ? (
        <Text dimColor>... +{props.preview.hiddenChars} more chars</Text>
      ) : null}
    </Box>
  );
}

function OverflowLine(props: { count: number; noun: string }) {
  return (
    <Text dimColor>
      ... +{props.count} {props.noun}
      {props.count === 1 ? "" : "s"}
    </Text>
  );
}

function buildHistoryDiffTitle(
  item: Extract<UiHistoryItem, { type: "diff" }>,
): string {
  if (item.toolName && item.path) {
    return `${item.toolName} · ${item.path}`;
  }
  if (item.toolName) {
    return item.toolName;
  }
  return item.path ?? "Diff";
}

function formatStatusLabel(status: PendingToolCardStatus): string {
  switch (status) {
    case "waiting_permission":
      return "approval";
    default:
      return status;
  }
}

function getStatusColor(
  status: PendingToolCardStatus,
): "cyan" | "green" | "red" | "yellow" {
  switch (status) {
    case "success":
      return "green";
    case "error":
      return "red";
    case "denied":
    case "waiting_permission":
      return "yellow";
    default:
      return "cyan";
  }
}

function formatOverflowNotice(count: number, noun: string): string | undefined {
  if (count <= 0) {
    return undefined;
  }

  return `(+${count} ${noun}${count === 1 ? "" : "s"})`;
}
