import { Box, Text } from "ink";
import type { InlinePermissionState } from "../inline-permission.js";
import { truncateDisplayWidth } from "../display-width.js";

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
          color={
            line.tone === "warning"
              ? "yellow"
              : line.tone === "error"
                ? "red"
                : line.tone === "selected"
                  ? "cyan"
                  : undefined
          }
          dimColor={line.tone === "dim"}
          bold={line.tone === "warning" || line.tone === "error" || line.tone === "selected"}
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
  tone: "warning" | "error" | "selected" | "dim" | "default";
}> {
  const width = Math.max(1, input.width);
  const lines: Array<{
    text: string;
    tone: "warning" | "error" | "selected" | "dim" | "default";
  }> = [];
  const title = [
    "Permission",
    input.state.toolName,
    formatRiskLabel(input.state.riskLevel),
    input.state.target,
  ]
    .filter((part): part is string => Boolean(part))
    .join(" · ");

  lines.push({
    text: clipToWidth(title, width),
    tone: input.state.riskLevel === "dangerous" ? "error" : "warning",
  });

  const detailLines = [
    input.state.reason ? `reason: ${input.state.reason}` : undefined,
    input.state.scope ? `scope: ${input.state.scope}` : undefined,
  ].filter((line): line is string => Boolean(line));

  const reservedChoiceLines = input.state.choices.length;
  const remainingAfterChoices = Math.max(0, input.height - 1 - reservedChoiceLines);
  const showHint = remainingAfterChoices > 0;
  const availableDetailLines = Math.max(0, remainingAfterChoices - (showHint ? 1 : 0));

  for (const detail of detailLines.slice(0, availableDetailLines)) {
    lines.push({
      text: clipToWidth(`  ${detail}`, width),
      tone: "dim",
    });
  }

  for (const [index, choice] of input.state.choices.entries()) {
    lines.push({
      text: clipToWidth(
        `${index === input.state.selectedIndex ? "› " : "  "}${choice.title}`,
        width,
      ),
      tone: index === input.state.selectedIndex ? "selected" : "default",
    });
  }

  if (showHint) {
    lines.push({
      text: clipToWidth("Enter confirms · Esc denies · Ctrl+C aborts", width),
      tone: "dim",
    });
  }

  return lines.slice(0, Math.max(0, input.height));
}

function clipToWidth(value: string, width: number): string {
  return truncateDisplayWidth(value, width);
}

function formatRiskLabel(riskLevel: InlinePermissionState["riskLevel"]): string {
  switch (riskLevel) {
    case "dangerous":
      return "dangerous";
    case "moderate":
      return "moderate";
    default:
      return "safe";
  }
}
