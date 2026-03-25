import { Box, Text } from "ink";

export function Composer(props: {
  width: number;
  value: string;
  turnState: "idle" | "running" | "waiting_permission";
  focused?: boolean;
  contextHint?: string;
}) {
  if (props.turnState === "running") {
    return (
      <Box width={props.width} overflow="hidden">
        <Text dimColor>{buildComposerStatusLine(props.width, "running... Ctrl+C cancels the turn.")}</Text>
      </Box>
    );
  }

  if (props.turnState === "waiting_permission") {
    return (
      <Box width={props.width} overflow="hidden">
        <Text dimColor>
          {buildComposerStatusLine(
            props.width,
            "waiting for permission... Esc denies, Ctrl+C aborts the turn.",
          )}
        </Text>
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
      <Text color={props.focused === false ? undefined : "cyan"} dimColor={props.focused === false}>
        {line.prompt}
      </Text>
      <Text dimColor={!props.value}>{line.body}</Text>
      <Text>{line.cursor}</Text>
    </Box>
  );
}

const PROMPT = "xpert> ";
const CURSOR = "█";
const COMPOSER_PLACEHOLDER =
  "/status /tools /session /exit | Up/Down history | terminal scrollback";

export function buildComposerInputLine(input: {
  width: number;
  value: string;
  focused?: boolean;
  contextHint?: string;
}): {
  prompt: string;
  body: string;
  cursor: string;
} {
  const width = Math.max(1, input.width);
  const availableBodyWidth = Math.max(0, width - stringWidth(PROMPT) - stringWidth(CURSOR));
  const source =
    input.value ||
    (input.focused === false
      ? input.contextHint ?? "Composer idle"
      : COMPOSER_PLACEHOLDER);

  return {
    prompt: clipToWidth(PROMPT, Math.max(0, width - stringWidth(CURSOR))),
    body: clipToWidth(source, availableBodyWidth),
    cursor: input.focused === false || width <= stringWidth(PROMPT) ? "" : CURSOR,
  };
}

export function buildComposerStatusLine(width: number, message: string): string {
  return clipToWidth(message, Math.max(1, width));
}

function clipToWidth(value: string, width: number): string {
  if (width <= 0) {
    return "";
  }

  const chars = Array.from(value);
  if (chars.length <= width) {
    return value;
  }

  if (width === 1) {
    return chars[0] ?? "";
  }

  return `${chars.slice(0, width - 1).join("")}…`;
}

function stringWidth(value: string): number {
  return Array.from(value).length;
}
