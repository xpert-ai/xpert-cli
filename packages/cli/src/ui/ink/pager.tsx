import { Box, Text } from "ink";
import { useEffect, useMemo } from "react";
import type { UiRenderBlock } from "../render-blocks.js";
import {
  describeTranscriptViewport,
  getVisibleTranscriptBlocks,
  measureTranscriptBlocks,
  syncTranscriptViewport,
  type TranscriptViewportSummary,
  type TranscriptViewportMetrics,
  type TranscriptViewportState,
  type MeasuredTranscriptBlock,
  type VisibleTranscriptBlock,
} from "../transcript-viewport.js";
import { BlockView, measureRenderBlock } from "./blocks.js";

const MIN_SCROLLBAR_WIDTH = 16;
const SCROLLBAR_WIDTH = 1;
const HEADER_SEPARATOR = " · ";

export function Pager(props: {
  width: number;
  height: number;
  title: string;
  blocks: UiRenderBlock[];
  viewport: TranscriptViewportState;
  focused: boolean;
  emptyLabel?: string;
  onViewportMetrics: (metrics: TranscriptViewportMetrics) => void;
}) {
  const viewportHeight = Math.max(0, props.height - 1);
  const pagerModel = useMemo(
    () =>
      buildPagerModel({
        width: props.width,
        viewportHeight,
        title: props.title,
        blocks: props.blocks,
        viewport: props.viewport,
        focused: props.focused,
      }),
    [props.blocks, props.focused, props.title, props.viewport, props.width, viewportHeight],
  );

  useEffect(() => {
    props.onViewportMetrics(pagerModel.metrics);
  }, [pagerModel.metrics, props.onViewportMetrics]);

  return (
    <Box flexDirection="column" width={props.width} height={props.height} overflow="hidden">
      <Text color={props.focused ? "cyan" : undefined} dimColor={!props.focused} bold>
        {pagerModel.header}
      </Text>
      <Box flexDirection="row" height={viewportHeight} overflow="hidden">
        <Box
          flexDirection="column"
          width={pagerModel.contentWidth}
          height={viewportHeight}
          overflow="hidden"
        >
          {pagerModel.visibleBlocks.length > 0 ? (
            pagerModel.visibleBlocks.map((block) => (
              <BlockView
                key={block.key}
                block={block.value}
                width={pagerModel.contentWidth}
                visibleStart={block.visibleStart}
                visibleEnd={block.visibleEnd}
              />
            ))
          ) : (
            <Text dimColor>{clipToWidth(props.emptyLabel ?? "(empty)", pagerModel.contentWidth)}</Text>
          )}
        </Box>
        {pagerModel.scrollbarRows.length > 0 ? (
          <Box flexDirection="column" width={SCROLLBAR_WIDTH} height={viewportHeight} overflow="hidden">
            {pagerModel.scrollbarRows.map((row, index) => (
              <Text
                key={`${props.title}:scrollbar:${index}`}
                color={row.tone === "thumb" && props.focused ? "cyan" : undefined}
                dimColor={row.tone !== "thumb"}
              >
                {row.text}
              </Text>
            ))}
          </Box>
        ) : null}
      </Box>
    </Box>
  );
}

export interface PagerHeaderInput {
  title: string;
  focused: boolean;
  summary: TranscriptViewportSummary;
  width: number;
}

export function formatPagerHeader(input: PagerHeaderInput): string {
  const state =
    input.summary.follow && input.summary.edge === "bottom"
      ? "live"
      : input.summary.overflow
        ? `scroll ${input.summary.percent}%`
        : input.summary.edge === "empty"
          ? "empty"
          : "fits";
  const range =
    input.summary.edge === "empty"
      ? "0/0"
      : `${input.summary.rangeStart}-${input.summary.rangeEnd}/${input.summary.contentHeight}`;
  const location =
    input.summary.edge === "middle"
      ? `${input.summary.percent}%`
      : input.summary.edge;
  const focus = input.focused ? "focus" : undefined;
  const parts = compactHeaderParts([input.title, state, range, location, focus], input.width);

  return clipToWidth(parts.join(HEADER_SEPARATOR), input.width);
}

export interface PagerScrollbarRow {
  text: string;
  tone: "track" | "thumb";
}

export function buildPagerScrollbarRows(input: {
  viewportHeight: number;
  summary: TranscriptViewportSummary;
}): PagerScrollbarRow[] {
  if (!input.summary.overflow || input.viewportHeight <= 0) {
    return [];
  }

  const thumbSize = clamp(
    Math.round(input.viewportHeight * (input.viewportHeight / input.summary.contentHeight)),
    1,
    input.viewportHeight,
  );
  const maxThumbTop = Math.max(0, input.viewportHeight - thumbSize);
  const thumbTop =
    input.summary.maxScroll === 0
      ? 0
      : Math.round((input.summary.scrollTop / input.summary.maxScroll) * maxThumbTop);

  return Array.from({ length: input.viewportHeight }, (_, index) => ({
    text: index >= thumbTop && index < thumbTop + thumbSize ? "█" : "│",
    tone: index >= thumbTop && index < thumbTop + thumbSize ? "thumb" : "track",
  }));
}

interface PagerModel {
  contentWidth: number;
  header: string;
  metrics: TranscriptViewportMetrics;
  visibleBlocks: VisibleTranscriptBlock<UiRenderBlock>[];
  scrollbarRows: PagerScrollbarRow[];
}

function buildPagerModel(input: {
  width: number;
  viewportHeight: number;
  title: string;
  blocks: UiRenderBlock[];
  viewport: TranscriptViewportState;
  focused: boolean;
}): PagerModel {
  const baseMeasurement = measureBlocks(input.blocks, input.width, input.viewportHeight);
  const baseReason =
    input.viewport.width !== baseMeasurement.metrics.width ||
    input.viewport.viewportHeight !== baseMeasurement.metrics.viewportHeight
      ? "resize"
      : "content";
  const baseViewport = syncTranscriptViewport(input.viewport, baseMeasurement.metrics, baseReason);
  const baseSummary = describeTranscriptViewport(baseViewport);
  const showScrollbar = shouldShowScrollbar({
    width: input.width,
    summary: baseSummary,
  });

  const finalMeasurement = showScrollbar
    ? measureBlocks(
        input.blocks,
        Math.max(1, input.width - SCROLLBAR_WIDTH),
        input.viewportHeight,
      )
    : baseMeasurement;
  const finalReason =
    input.viewport.width !== finalMeasurement.metrics.width ||
    input.viewport.viewportHeight !== finalMeasurement.metrics.viewportHeight
      ? "resize"
      : "content";
  const finalViewport = syncTranscriptViewport(input.viewport, finalMeasurement.metrics, finalReason);
  const finalSummary = describeTranscriptViewport(finalViewport);

  return {
    contentWidth: finalMeasurement.metrics.width,
    header: formatPagerHeader({
      title: input.title,
      focused: input.focused,
      summary: finalSummary,
      width: input.width,
    }),
    metrics: finalMeasurement.metrics,
    visibleBlocks: getVisibleTranscriptBlocks(finalMeasurement.measuredBlocks, finalViewport),
    scrollbarRows: showScrollbar
      ? buildPagerScrollbarRows({
          viewportHeight: input.viewportHeight,
          summary: finalSummary,
        })
      : [],
  };
}

function measureBlocks(
  blocks: UiRenderBlock[],
  width: number,
  viewportHeight: number,
): {
  measuredBlocks: MeasuredTranscriptBlock<UiRenderBlock>[];
  metrics: TranscriptViewportMetrics;
} {
  const measuredBlocks = measureTranscriptBlocks(blocks, {
    getKey: (block) => block.id,
    measure: (block) => measureRenderBlock(block, width),
  });

  return {
    measuredBlocks,
    metrics: {
      contentHeight: measuredBlocks.reduce((sum, block) => sum + block.rowCount, 0),
      viewportHeight,
      width,
    },
  };
}

function shouldShowScrollbar(input: {
  width: number;
  summary: TranscriptViewportSummary;
}): boolean {
  return input.summary.overflow && input.width >= MIN_SCROLLBAR_WIDTH;
}

function compactHeaderParts(parts: Array<string | undefined>, width: number): string[] {
  const filtered = parts.filter((part): part is string => Boolean(part && part.length > 0));
  if (filtered.length === 0) {
    return [];
  }

  const variants = [
    filtered,
    filtered.filter((part) => part !== "focus"),
    filtered.filter((part) => part !== "focus" && part !== "fit" && part !== "fits"),
  ];

  for (const variant of variants) {
    if (variant.length === 0) {
      continue;
    }
    if (stringWidth(variant.join(HEADER_SEPARATOR)) <= width) {
      return variant;
    }
  }

  return [filtered[0] ?? ""];
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

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
