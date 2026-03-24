import { Box, Text } from "ink";
import { useEffect, useMemo } from "react";
import type { PendingTurnState, UiHistoryItem } from "../history.js";
import type { InspectorPanelData } from "../commands.js";
import {
  getViewportRange,
  syncViewport,
  type ViewportMetrics,
  type ViewportState,
} from "../viewport.js";
import {
  resolveInkColumns,
  resolveInkHeights,
} from "../ink-layout.js";
import {
  InkLineView,
  buildHistoryLines,
  buildInspectorLines,
  buildPendingLines,
  wrapInkLines,
} from "./history-item.js";

export function MainContent(props: {
  terminalWidth: number;
  terminalHeight: number;
  permissionVisible: boolean;
  permissionChoiceCount: number;
  history: UiHistoryItem[];
  pending: PendingTurnState;
  inspector: InspectorPanelData | null;
  historyViewport: ViewportState;
  onHistoryViewportMetrics: (metrics: ViewportMetrics) => void;
}) {
  const columns = useMemo(
    () =>
      resolveInkColumns({
        terminalWidth: props.terminalWidth,
        inspectorOpen: Boolean(props.inspector),
      }),
    [props.inspector, props.terminalWidth],
  );

  const historyLines = useMemo(
    () => wrapInkLines(buildHistoryLines(props.history), columns.contentWidth),
    [columns.contentWidth, props.history],
  );
  const pendingLines = useMemo(
    () => wrapInkLines(buildPendingLines(props.pending), columns.contentWidth),
    [columns.contentWidth, props.pending],
  );
  const inspectorLines = useMemo(
    () =>
      props.inspector
        ? wrapInkLines(buildInspectorLines(props.inspector), columns.inspectorWidth)
        : [],
    [columns.inspectorWidth, props.inspector],
  );

  const heights = useMemo(
    () =>
      resolveInkHeights({
        terminalHeight: props.terminalHeight,
        permissionVisible: props.permissionVisible,
        permissionChoiceCount: props.permissionChoiceCount,
        inspectorMode: columns.inspectorMode,
        inspectorLineCount: inspectorLines.length,
        pendingLineCount: pendingLines.length,
      }),
    [
      columns.inspectorMode,
      inspectorLines.length,
      pendingLines.length,
      props.permissionChoiceCount,
      props.permissionVisible,
      props.terminalHeight,
    ],
  );

  const historyMetrics = useMemo<ViewportMetrics>(
    () => ({
      contentHeight: historyLines.length,
      viewportHeight: Math.max(0, heights.historyBoxHeight - 1),
      wrapWidth: columns.contentWidth,
    }),
    [columns.contentWidth, heights.historyBoxHeight, historyLines.length],
  );

  useEffect(() => {
    props.onHistoryViewportMetrics(historyMetrics);
  }, [historyMetrics, props.onHistoryViewportMetrics]);

  const historyViewportReason =
    props.historyViewport.wrapWidth !== historyMetrics.wrapWidth ||
    props.historyViewport.viewportHeight !== historyMetrics.viewportHeight
      ? "resize"
      : "content";
  const visibleHistoryViewport = syncViewport(
    props.historyViewport,
    historyMetrics,
    historyViewportReason,
  );
  const historyRange = getViewportRange(visibleHistoryViewport);
  const visibleHistoryLines = historyLines.slice(historyRange.start, historyRange.end);

  const historyTitle = formatHistoryTitle({
    follow: visibleHistoryViewport.follow,
    start: historyRange.start,
    end: historyRange.end,
    total: historyLines.length,
  });

  const pendingViewportHeight = Math.max(0, heights.pendingBoxHeight - 1);
  const visiblePendingLines =
    pendingViewportHeight > 0
      ? pendingLines.slice(Math.max(0, pendingLines.length - pendingViewportHeight))
      : [];
  const hiddenPendingLineCount = Math.max(0, pendingLines.length - visiblePendingLines.length);
  const pendingTitle =
    hiddenPendingLineCount > 0
      ? `Current Turn (+${hiddenPendingLineCount} earlier line${hiddenPendingLineCount === 1 ? "" : "s"})`
      : "Current Turn";

  const inspectorViewportHeight = Math.max(0, heights.inspectorBoxHeight - 1);
  const visibleInspectorLines =
    inspectorViewportHeight > 0
      ? inspectorLines.slice(0, inspectorViewportHeight)
      : [];
  const hiddenInspectorLineCount = Math.max(
    0,
    inspectorLines.length - visibleInspectorLines.length,
  );
  const inspectorTitle = props.inspector
    ? hiddenInspectorLineCount > 0
      ? `${props.inspector.title} Panel (Esc closes, +${hiddenInspectorLineCount} more)`
      : `${props.inspector.title} Panel (Esc closes)`
    : "";

  if (columns.inspectorMode === "split" && props.inspector) {
    return (
      <Box flexDirection="row" height={heights.mainHeight}>
        <Box
          flexDirection="column"
          width={columns.contentWidth}
          height={heights.mainHeight}
          overflow="hidden"
        >
          <ConversationColumn
            historyTitle={historyTitle}
            historyLines={visibleHistoryLines}
            historyBoxHeight={heights.historyBoxHeight}
            historyWidth={columns.contentWidth}
            pendingTitle={pendingTitle}
            pendingLines={visiblePendingLines}
            pendingBoxHeight={heights.pendingBoxHeight}
            pendingWidth={columns.contentWidth}
          />
        </Box>
        <Box
          flexDirection="column"
          width={columns.inspectorWidth}
          height={heights.mainHeight}
          overflow="hidden"
        >
          <Pane
            title={inspectorTitle}
            lines={visibleInspectorLines}
            height={heights.inspectorBoxHeight}
            width={columns.inspectorWidth}
          />
        </Box>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" height={heights.mainHeight} overflow="hidden">
      {columns.inspectorMode === "overlay" && props.inspector ? (
        <Pane
          title={inspectorTitle}
          lines={visibleInspectorLines}
          height={heights.inspectorBoxHeight}
          width={columns.contentWidth}
        />
      ) : null}
      <ConversationColumn
        historyTitle={historyTitle}
        historyLines={visibleHistoryLines}
        historyBoxHeight={heights.historyBoxHeight}
        historyWidth={columns.contentWidth}
        pendingTitle={pendingTitle}
        pendingLines={visiblePendingLines}
        pendingBoxHeight={heights.pendingBoxHeight}
        pendingWidth={columns.contentWidth}
      />
    </Box>
  );
}

function ConversationColumn(props: {
  historyTitle: string;
  historyLines: ReturnType<typeof wrapInkLines>;
  historyBoxHeight: number;
  historyWidth: number;
  pendingTitle: string;
  pendingLines: ReturnType<typeof wrapInkLines>;
  pendingBoxHeight: number;
  pendingWidth: number;
}) {
  return (
    <Box flexDirection="column" flexGrow={1} overflow="hidden">
      <Pane
        title={props.historyTitle}
        lines={props.historyLines}
        height={props.historyBoxHeight}
        width={props.historyWidth}
      />
      {props.pendingBoxHeight > 0 ? (
        <Pane
          title={props.pendingTitle}
          lines={props.pendingLines}
          height={props.pendingBoxHeight}
          width={props.pendingWidth}
        />
      ) : null}
    </Box>
  );
}

function Pane(props: {
  title: string;
  lines: ReturnType<typeof wrapInkLines>;
  height: number;
  width: number;
}) {
  if (props.height <= 0) {
    return null;
  }

  return (
    <Box
      flexDirection="column"
      height={props.height}
      overflow="hidden"
    >
      <Text bold color="cyan">
        {clipToWidth(props.title, Math.max(1, props.width))}
      </Text>
      {props.lines.length > 0 ? (
        props.lines.map((line) => <InkLineView key={line.key} line={line} />)
      ) : (
        <Text dimColor>(empty)</Text>
      )}
    </Box>
  );
}

function formatHistoryTitle(input: {
  follow: boolean;
  start: number;
  end: number;
  total: number;
}): string {
  if (input.total === 0) {
    return "History (empty)";
  }

  return `History (${input.follow ? "follow" : "scroll"}) ${input.start + 1}-${input.end}/${input.total}`;
}

function clipToWidth(value: string, width: number): string {
  const chars = Array.from(value);
  if (chars.length <= width) {
    return value;
  }

  if (width <= 1) {
    return chars[0] ?? "";
  }

  return `${chars.slice(0, width - 1).join("")}…`;
}
