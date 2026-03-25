import { Box, Text } from "ink";
import {
  stringDisplayWidth,
  truncateDisplayWidth,
} from "../display-width.js";

export function Composer(props: {
  width: number;
  value: string;
  turnState: "idle" | "running" | "waiting_permission";
  focused?: boolean;
  contextHint?: string;
}) {
  if (props.turnState === "running") {
    const line = buildComposerStatusLine(
      props.width,
      "[RUNNING] Turn active · Ctrl+C aborts",
    );
    return (
      <Box width={props.width} overflow="hidden">
        <Text color="yellow">{line}</Text>
      </Box>
    );
  }

  if (props.turnState === "waiting_permission") {
    const line = buildComposerStatusLine(
      props.width,
      "[PERMISSION] Choose below · Esc denies · Ctrl+C aborts",
    );
    return (
      <Box width={props.width} overflow="hidden">
        <Text color="yellow">{line}</Text>
      </Box>
    );
  }

  const line = buildComposerInputLine({
    width: props.width,
    value: props.value,
    focused: props.focused ?? true,
    contextHint: props.contextHint,
  });

  return (
    <Box width={props.width} overflow="hidden">
      <Text color={props.focused === false ? undefined : "green"} dimColor={props.focused === false}>
        {line.badge}
      </Text>
      <Text color={props.focused === false ? undefined : "cyan"} dimColor={props.focused === false}>
        {line.prompt}
      </Text>
      <Text dimColor={!props.value}>{line.body}</Text>
      <Text>{line.cursor}</Text>
    </Box>
  );
}

const READY_BADGE = "[READY] ";
const PROMPT = "xpert> ";
const CURSOR = "█";
const COMPOSER_PLACEHOLDER =
  "Ask for a change or run /status /tools /session";

export function buildComposerInputLine(input: {
  width: number;
  value: string;
  focused?: boolean;
  contextHint?: string;
}): {
  badge: string;
  prompt: string;
  body: string;
  cursor: string;
} {
  const width = Math.max(1, input.width);
  const source =
    input.value ||
    (input.focused === false
      ? input.contextHint ?? "Composer idle"
      : COMPOSER_PLACEHOLDER);
  const cursor = input.focused === false || width <= stringDisplayWidth(READY_BADGE) + stringDisplayWidth(PROMPT)
    ? ""
    : CURSOR;
  const availableBodyWidth = Math.max(
    0,
    width -
      stringDisplayWidth(READY_BADGE) -
      stringDisplayWidth(PROMPT) -
      stringDisplayWidth(cursor),
  );

  return {
    badge: truncateDisplayWidth(READY_BADGE, Math.max(0, width - stringDisplayWidth(cursor))),
    prompt: truncateDisplayWidth(
      PROMPT,
      Math.max(0, width - stringDisplayWidth(READY_BADGE) - stringDisplayWidth(cursor)),
    ),
    body: truncateDisplayWidth(source, availableBodyWidth),
    cursor,
  };
}

export function buildComposerStatusLine(width: number, message: string): string {
  return truncateDisplayWidth(message, Math.max(1, width));
}
