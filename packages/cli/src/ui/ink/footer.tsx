import path from "node:path";
import { Box, Text } from "ink";
import type { ApprovalMode } from "@xpert-cli/contracts";

export function Footer(props: {
  cwd: string;
  git: string;
  sessionId: string;
  assistantId?: string;
  approvalMode: ApprovalMode;
  turnState: "idle" | "running" | "waiting_permission";
  notice?: {
    level: "info" | "warning" | "error";
    message: string;
  };
}) {
  const parts = [
    "xpert-cli",
    shortPath(props.cwd),
    `s ${props.sessionId.slice(0, 8)}`,
    `turn ${formatTurnState(props.turnState)}`,
    `approval ${props.approvalMode}`,
    `git ${clip(props.git, 28)}`,
    `asst ${clip(props.assistantId ?? "(unconfigured)", 18)}`,
  ];
  const notice = props.notice
    ? `${props.notice.level === "info" ? "notice" : props.notice.level}: ${clip(props.notice.message, 48)}`
    : undefined;

  return (
    <Box marginTop={1}>
      <Text dimColor>{parts.join(" | ")}</Text>
      {notice ? (
        <>
          <Text dimColor> | </Text>
          <Text color={getNoticeColor(props.notice?.level)}>{notice}</Text>
        </>
      ) : null}
    </Box>
  );
}

function formatTurnState(value: "idle" | "running" | "waiting_permission"): string {
  switch (value) {
    case "waiting_permission":
      return "approval";
    default:
      return value;
  }
}

function getNoticeColor(
  level: "info" | "warning" | "error" | undefined,
): "cyan" | "yellow" | "red" {
  switch (level) {
    case "warning":
      return "yellow";
    case "error":
      return "red";
    default:
      return "cyan";
  }
}

function shortPath(value: string): string {
  const base = path.basename(value);
  if (base && base !== path.sep) {
    return base;
  }

  return clip(value, 32);
}

function clip(value: string, maxChars: number): string {
  if (value.length <= maxChars) {
    return value;
  }

  return `${value.slice(0, maxChars - 3)}...`;
}
