import { Box, Text } from "ink";
import type { PendingTurnEntry, PendingTurnState, UiHistoryItem } from "../history.js";

export function HistoryItemView(props: { item: UiHistoryItem }) {
  return renderEntry(props.item);
}

export function PendingTurnView(props: { pending: PendingTurnState }) {
  if (props.pending.entries.length === 0) {
    return null;
  }

  return (
    <Box flexDirection="column" marginTop={1}>
      {props.pending.entries.map((item, index) => (
        <Box key={`pending-${index}`}>
          {renderPendingEntry(item)}
        </Box>
      ))}
    </Box>
  );
}

function renderPendingEntry(item: PendingTurnEntry) {
  switch (item.type) {
    case "assistant_text":
      return <Text>{item.text}</Text>;
    case "reasoning":
      return <Text dimColor>[reasoning] {item.text}</Text>;
    case "tool_call":
      return (
        <Text color="cyan">
          tool: {item.toolName}
          {item.target ? ` -> ${item.target}` : ""}
        </Text>
      );
    case "tool_result":
      return (
        <Text color="green">
          done {item.toolName}: {item.summary}
        </Text>
      );
    case "bash_line":
      return <Text dimColor>{item.text}</Text>;
    case "diff":
      return <Text color="yellow">{item.text}</Text>;
    case "warning":
      return <Text color="yellow">warn: {item.text}</Text>;
    case "error":
      return <Text color="red">error: {item.text}</Text>;
  }
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
        <Text color="cyan">
          tool: {item.toolName}
          {item.target ? ` -> ${item.target}` : ""}
        </Text>
      );
    case "tool_result":
      return (
        <Text color="green">
          done {item.toolName}: {item.summary}
        </Text>
      );
    case "bash_line":
      return <Text dimColor>{item.text}</Text>;
    case "diff":
      return <Text color="yellow">{item.text}</Text>;
    case "warning":
      return <Text color="yellow">warn: {item.text}</Text>;
    case "error":
      return <Text color="red">error: {item.text}</Text>;
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
