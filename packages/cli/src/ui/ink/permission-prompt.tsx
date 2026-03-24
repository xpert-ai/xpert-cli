import { Box, Text } from "ink";
import type { InlinePermissionState } from "../inline-permission.js";

export function PermissionPrompt(props: {
  width: number;
  height: number;
  state: InlinePermissionState;
}) {
  const lines = buildPermissionPromptLines({
    width: props.width,
    height: props.height,
    state: props.state,
  });

  return (
    <Box flexDirection="column" width={props.width} height={props.height} overflow="hidden">
      {lines.map((line, index) => (
        <Text
          key={`permission:${index}`}
          color={line.tone === "warning" ? "yellow" : line.tone === "selected" ? "green" : undefined}
          dimColor={line.tone === "dim"}
          bold={line.tone === "warning"}
        >
          {line.text}
        </Text>
      ))}
    </Box>
  );
}

export function buildPermissionPromptLines(input: {
  width: number;
  height: number;
  state: InlinePermissionState;
}): Array<{
  text: string;
  tone: "warning" | "selected" | "dim" | "default";
}> {
  const width = Math.max(1, input.width);
  const lines: Array<{
    text: string;
    tone: "warning" | "selected" | "dim" | "default";
  }> = [
    {
      text: clipToWidth(`Permission: ${input.state.message}`, width),
      tone: "warning",
    },
  ];

  for (const [index, choice] of input.state.choices.entries()) {
    lines.push({
      text: clipToWidth(
        `${index === input.state.selectedIndex ? "> " : "  "}${choice.title}`,
        width,
      ),
      tone: index === input.state.selectedIndex ? "selected" : "default",
    });
  }

  if (input.height > input.state.choices.length + 1) {
    lines.push({
      text: clipToWidth("Enter confirms. Esc denies. Ctrl+C aborts.", width),
      tone: "dim",
    });
  }

  return lines.slice(0, Math.max(0, input.height));
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
