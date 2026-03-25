import path from "node:path";
import { Box, Text } from "ink";
import type { InspectorPanel } from "../commands.js";
import type { UiFocusTarget } from "../interactive-state.js";
import {
  describeTranscriptViewport,
  type TranscriptViewportState,
} from "../transcript-viewport.js";

export function HeaderBar(props: {
  width: number;
  cwd: string;
  sessionId: string;
  assistantId?: string;
  focus: UiFocusTarget;
  transcriptViewport: TranscriptViewportState;
  overlayPanel: InspectorPanel | null;
  overlayViewport: TranscriptViewportState;
}) {
  const line = buildHeaderLine({
    width: props.width,
    parts: [
      "xpert-cli",
      shortPath(props.cwd),
      `s ${props.sessionId.slice(0, 8)}`,
      buildViewportLabel({
        overlayPanel: props.overlayPanel,
        transcriptViewport: props.transcriptViewport,
        overlayViewport: props.overlayViewport,
      }),
      `focus ${props.focus}`,
      `asst ${clip(props.assistantId ?? "(unconfigured)", 18)}`,
    ],
  });

  return (
    <Box width={props.width} overflow="hidden">
      <Text dimColor>{line}</Text>
    </Box>
  );
}

export function buildHeaderLine(input: {
  width: number;
  parts: string[];
}): string {
  return clipToWidth(input.parts.join(" | "), input.width);
}

export function buildViewportLabel(input: {
  overlayPanel: InspectorPanel | null;
  transcriptViewport: Pick<
    TranscriptViewportState,
    "contentHeight" | "viewportHeight" | "scrollTop" | "follow"
  >;
  overlayViewport: Pick<
    TranscriptViewportState,
    "contentHeight" | "viewportHeight" | "scrollTop" | "follow"
  >;
}): string {
  if (input.overlayPanel) {
    const summary = describeTranscriptViewport(input.overlayViewport);
    return `overlay ${input.overlayPanel} ${formatViewportState(summary, false)}`;
  }

  const summary = describeTranscriptViewport(input.transcriptViewport);
  return `transcript ${formatViewportState(summary, true)}`;
}

function shortPath(value: string): string {
  const base = path.basename(value);
  return base && base !== path.sep ? base : clip(value, 32);
}

function formatViewportState(
  summary: ReturnType<typeof describeTranscriptViewport>,
  allowLive: boolean,
): string {
  if (summary.edge === "empty") {
    return "empty";
  }

  if (!summary.overflow) {
    return "fit";
  }

  const range = `${summary.rangeStart}-${summary.rangeEnd}/${summary.contentHeight}`;
  if (allowLive && summary.follow && summary.edge === "bottom") {
    return `live ${range}`;
  }
  if (summary.edge === "top") {
    return `top ${range}`;
  }
  if (summary.edge === "bottom") {
    return `bottom ${range}`;
  }

  return `scroll ${summary.percent}% ${range}`;
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
