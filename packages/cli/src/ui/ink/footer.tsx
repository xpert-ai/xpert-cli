import path from "node:path";
import { Box, Text } from "ink";
import type { ApprovalMode } from "@xpert-cli/contracts";
import type { InspectorPanel } from "../commands.js";

export function Footer(props: {
  width: number;
  cwd: string;
  git: string;
  sessionId: string;
  assistantId?: string;
  approvalMode: ApprovalMode;
  turnState: "idle" | "running" | "waiting_permission";
  followLatest: boolean;
  inspectorPanel: InspectorPanel | null;
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
    `view ${props.followLatest ? "follow" : "scroll"}`,
    `panel ${props.inspectorPanel ?? "off"}`,
    `approval ${props.approvalMode}`,
    `git ${clip(props.git, 28)}`,
    `asst ${clip(props.assistantId ?? "(unconfigured)", 18)}`,
  ];
  const notice = props.notice
    ? `${props.notice.level === "info" ? "notice" : props.notice.level}: ${clip(props.notice.message, 48)}`
    : undefined;
  const line = buildFooterLine({
    width: props.width,
    base: parts.join(" | "),
    notice,
  });

  return (
    <Box width={props.width} overflow="hidden">
      <Text dimColor>{line.base}</Text>
      {line.notice && line.base ? (
        <>
          <Text dimColor> | </Text>
          <Text color={getNoticeColor(props.notice?.level)}>{line.notice}</Text>
        </>
      ) : line.notice ? (
        <Text color={getNoticeColor(props.notice?.level)}>{line.notice}</Text>
      ) : null}
    </Box>
  );
}

export function buildFooterLine(input: {
  width: number;
  base: string;
  notice?: string;
}): {
  base: string;
  notice?: string;
} {
  const width = Math.max(1, input.width);
  if (!input.notice) {
    return {
      base: clipToWidth(input.base, width),
    };
  }

  const noticeBudget = Math.min(
    stringWidth(input.notice),
    Math.max(12, Math.floor(width * 0.4)),
  );
  const separatorWidth = 3;
  const availableBaseWidth = Math.max(0, width - separatorWidth - noticeBudget);

  if (availableBaseWidth <= 0) {
    return {
      base: "",
      notice: clipToWidth(input.notice, width),
    };
  }

  return {
    base: clipToWidth(input.base, availableBaseWidth),
    notice: clipToWidth(input.notice, width - availableBaseWidth - separatorWidth),
  };
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
