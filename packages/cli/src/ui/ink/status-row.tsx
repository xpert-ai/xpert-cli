import { Box, Text } from "ink";
import { useEffect, useState } from "react";
import type { UiRenderBlock } from "../render-blocks.js";
import { stringDisplayWidth, truncateDisplayWidth } from "../display-width.js";

const SPINNER_FRAMES = ["◐", "◓", "◑", "◒"] as const;

export function StatusRow(props: {
  width: number;
  turnState: "idle" | "running" | "waiting_permission";
  pendingBlocks: UiRenderBlock[];
  startedAtMs?: number;
  notice?: {
    level: "info" | "warning" | "error";
    message: string;
  };
}) {
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (props.turnState === "idle") {
      setTick(0);
      return;
    }

    const timer = setInterval(() => {
      setTick((current) => current + 1);
    }, 120);

    return () => {
      clearInterval(timer);
    };
  }, [props.turnState]);

  const model = deriveStatusRowModel({
    turnState: props.turnState,
    pendingBlocks: props.pendingBlocks,
    elapsedMs: props.startedAtMs ? Date.now() - props.startedAtMs : 0,
    notice: props.notice,
    spinnerFrame: SPINNER_FRAMES[tick % SPINNER_FRAMES.length] ?? SPINNER_FRAMES[0],
  });
  const line = buildStatusRowText({
    width: props.width,
    model,
  });

  return (
    <Box width={props.width} overflow="hidden">
      <Text color={getToneColor(model.level)}>{line}</Text>
    </Box>
  );
}

export interface StatusRowModel {
  badge: string;
  action: string;
  elapsed?: string;
  hint: string;
  notice?: string;
  noticeLabel?: string;
  level: "info" | "warning" | "error";
}

export function deriveStatusRowModel(input: {
  turnState: "idle" | "running" | "waiting_permission";
  pendingBlocks: UiRenderBlock[];
  elapsedMs: number;
  notice?: {
    level: "info" | "warning" | "error";
    message: string;
  };
  spinnerFrame: string;
}): StatusRowModel {
  if (input.turnState === "waiting_permission") {
    const waitingTool = input.pendingBlocks.find(
      (block) => block.kind === "tool_group" && block.status === "waiting_permission",
    );
    return {
      badge: "[WAIT]",
      action:
        waitingTool?.kind === "tool_group"
          ? `${waitingTool.toolName}${waitingTool.target ? ` · ${waitingTool.target}` : ""}`
          : "Waiting for permission",
      elapsed: formatElapsed(input.elapsedMs),
      hint: "Esc denies · Ctrl+C aborts",
      notice: input.notice ? truncateDisplayWidth(input.notice.message, 40) : undefined,
      noticeLabel: input.notice ? formatNoticeLabel(input.notice.level) : undefined,
      level: input.notice?.level === "error" ? "error" : "warning",
    };
  }

  if (input.turnState === "running") {
    return {
      badge: `[${input.spinnerFrame}]`,
      action: deriveRunningAction(input.pendingBlocks),
      elapsed: formatElapsed(input.elapsedMs),
      hint: "Ctrl+C aborts",
      notice: input.notice ? truncateDisplayWidth(input.notice.message, 40) : undefined,
      noticeLabel: input.notice ? formatNoticeLabel(input.notice.level) : undefined,
      level: input.notice?.level ?? "info",
    };
  }

  return {
    badge: "[IDLE]",
    action: "Ready",
    hint: "Scrollback keeps history · /status /tools /session",
    notice: input.notice ? truncateDisplayWidth(input.notice.message, 40) : undefined,
    noticeLabel: input.notice ? formatNoticeLabel(input.notice.level) : undefined,
    level: input.notice?.level ?? "info",
  };
}

export function buildStatusRowText(input: {
  width: number;
  model: StatusRowModel;
}): string {
  const segments = [
    input.model.elapsed,
    input.model.notice && input.model.noticeLabel
      ? `${input.model.noticeLabel}: ${input.model.notice}`
      : undefined,
    input.model.hint,
  ].filter((segment): segment is string => Boolean(segment));

  let line = `${input.model.badge} ${input.model.action}`;
  for (const segment of segments) {
    const next = `${line} │ ${segment}`;
    if (stringDisplayWidth(next) <= input.width) {
      line = next;
      continue;
    }

    const remainingWidth = Math.max(0, input.width - stringDisplayWidth(`${line} │ `));
    if (remainingWidth > 0) {
      line = `${line} │ ${truncateDisplayWidth(segment, remainingWidth)}`;
    }
    break;
  }

  return truncateDisplayWidth(line, Math.max(1, input.width));
}

export function formatElapsed(elapsedMs: number): string {
  const seconds = Math.max(0, Math.floor(elapsedMs / 1000));
  if (seconds < 60) {
    return `${seconds}s`;
  }
  if (seconds < 3600) {
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${minutes}m ${String(remainingSeconds).padStart(2, "0")}s`;
  }
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainingSeconds = seconds % 60;
  return `${hours}h ${String(minutes).padStart(2, "0")}m ${String(remainingSeconds).padStart(2, "0")}s`;
}

function deriveRunningAction(blocks: UiRenderBlock[]): string {
  const runningTool = [...blocks]
    .reverse()
    .find(
      (block) =>
        block.kind === "tool_group" &&
        (block.status === "running" || block.status === "waiting_permission"),
    );
  if (runningTool?.kind === "tool_group") {
    return `${runningTool.toolName}${runningTool.target ? ` · ${runningTool.target}` : ""}`;
  }

  const bashBlock = [...blocks].reverse().find((block) => block.kind === "bash_output");
  if (bashBlock?.kind === "bash_output") {
    return bashBlock.title;
  }

  if (blocks.some((block) => block.kind === "thinking")) {
    return "Thinking";
  }
  if (blocks.some((block) => block.kind === "assistant_message")) {
    return "Responding";
  }

  return "Working";
}

function formatNoticeLabel(level: "info" | "warning" | "error"): string {
  switch (level) {
    case "warning":
      return "warn";
    case "error":
      return "error";
    default:
      return "note";
  }
}

function getToneColor(
  level: "info" | "warning" | "error",
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
