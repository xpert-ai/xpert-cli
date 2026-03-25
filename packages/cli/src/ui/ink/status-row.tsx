import { Box, Text } from "ink";
import { useEffect, useState } from "react";
import type { UiRenderBlock } from "../render-blocks.js";

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
  indicator: string;
  action: string;
  elapsed?: string;
  hint: string;
  notice?: string;
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
    return {
      indicator: "!",
      action: "Waiting for permission",
      elapsed: formatElapsed(input.elapsedMs),
      hint: "Esc denies · Ctrl+C aborts",
      notice: input.notice ? clipInline(input.notice.message, 48) : undefined,
      level: input.notice?.level === "error" ? "error" : "warning",
    };
  }

  if (input.turnState === "running") {
    return {
      indicator: input.spinnerFrame,
      action: deriveRunningAction(input.pendingBlocks),
      elapsed: formatElapsed(input.elapsedMs),
      hint: "Ctrl+C aborts",
      notice: input.notice ? clipInline(input.notice.message, 48) : undefined,
      level: input.notice?.level ?? "info",
    };
  }

  return {
    indicator: "○",
    action: "Ready",
    hint: "Terminal scrollback keeps history · /status /tools /session",
    notice: input.notice ? clipInline(input.notice.message, 48) : undefined,
    level: input.notice?.level ?? "info",
  };
}

export function buildStatusRowText(input: {
  width: number;
  model: StatusRowModel;
}): string {
  const parts = [`${input.model.indicator} ${input.model.action}`];
  if (input.model.elapsed) {
    parts.push(input.model.elapsed);
  }
  parts.push(input.model.hint);
  if (input.model.notice) {
    parts.push(input.model.notice);
  }

  return clipInline(parts.join(" · "), input.width);
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
    return `Running ${runningTool.toolName}`;
  }

  const bashBlock = [...blocks].reverse().find((block) => block.kind === "bash_output");
  if (bashBlock?.kind === "bash_output") {
    return `Running ${bashBlock.title}`;
  }

  if (blocks.some((block) => block.kind === "thinking")) {
    return "Thinking";
  }
  if (blocks.some((block) => block.kind === "assistant_message")) {
    return "Responding";
  }

  return "Working";
}

function clipInline(value: string, width: number): string {
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
