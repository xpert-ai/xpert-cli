export interface TranscriptViewportMetrics {
  contentHeight: number;
  viewportHeight: number;
  width: number;
}

export interface TranscriptViewportState extends TranscriptViewportMetrics {
  scrollTop: number;
  follow: boolean;
}

export type TranscriptViewportEdge = "empty" | "fit" | "top" | "middle" | "bottom";

export interface TranscriptViewportSummary {
  contentHeight: number;
  viewportHeight: number;
  scrollTop: number;
  follow: boolean;
  maxScroll: number;
  overflow: boolean;
  rangeStart: number;
  rangeEnd: number;
  percent: number;
  edge: TranscriptViewportEdge;
}

export type TranscriptViewportSyncReason = "content" | "resize";

export interface MeasuredTranscriptBlock<TValue> {
  key: string;
  value: TValue;
  rowCount: number;
}

export interface VisibleTranscriptBlock<TValue>
  extends MeasuredTranscriptBlock<TValue> {
  visibleStart: number;
  visibleEnd: number;
}

export function createTranscriptViewportState(options?: {
  follow?: boolean;
}): TranscriptViewportState {
  return {
    scrollTop: 0,
    follow: options?.follow ?? true,
    contentHeight: 0,
    viewportHeight: 0,
    width: 0,
  };
}

export function syncTranscriptViewport(
  current: TranscriptViewportState,
  nextMetrics: TranscriptViewportMetrics,
  reason: TranscriptViewportSyncReason = "content",
): TranscriptViewportState {
  const metrics = normalizeMetrics(nextMetrics);
  const nextMaxScroll = getMaxScroll(metrics);

  if (current.follow) {
    return {
      ...metrics,
      scrollTop: nextMaxScroll,
      follow: true,
    };
  }

  let scrollTop = clamp(current.scrollTop, 0, nextMaxScroll);
  if (reason === "resize") {
    const previousMaxScroll = getMaxScroll(current);
    if (previousMaxScroll > 0 && nextMaxScroll > 0) {
      scrollTop = clamp(
        Math.round((current.scrollTop / previousMaxScroll) * nextMaxScroll),
        0,
        nextMaxScroll,
      );
    }
  }

  return {
    ...metrics,
    scrollTop,
    follow: scrollTop >= nextMaxScroll,
  };
}

export function scrollTranscriptViewportBy(
  current: TranscriptViewportState,
  delta: number,
): TranscriptViewportState {
  const nextMaxScroll = getMaxScroll(current);
  const scrollTop = clamp(current.scrollTop + delta, 0, nextMaxScroll);

  return {
    ...current,
    scrollTop,
    follow: scrollTop >= nextMaxScroll,
  };
}

export function scrollTranscriptViewportToStart(
  current: TranscriptViewportState,
): TranscriptViewportState {
  return {
    ...current,
    scrollTop: 0,
    follow: getMaxScroll(current) === 0,
  };
}

export function scrollTranscriptViewportToEnd(
  current: TranscriptViewportState,
): TranscriptViewportState {
  return {
    ...current,
    scrollTop: getMaxScroll(current),
    follow: true,
  };
}

export function measureTranscriptBlocks<TValue>(
  values: TValue[],
  options: {
    getKey: (value: TValue, index: number) => string;
    measure: (value: TValue) => number;
  },
): MeasuredTranscriptBlock<TValue>[] {
  return values.map((value, index) => ({
    key: options.getKey(value, index),
    value,
    rowCount: Math.max(0, Math.floor(options.measure(value))),
  }));
}

export function getVisibleTranscriptBlocks<TValue>(
  blocks: MeasuredTranscriptBlock<TValue>[],
  viewport: Pick<TranscriptViewportState, "scrollTop" | "viewportHeight">,
): VisibleTranscriptBlock<TValue>[] {
  const startRow = clamp(viewport.scrollTop, 0, Number.MAX_SAFE_INTEGER);
  const endRow = startRow + Math.max(0, viewport.viewportHeight);
  const visible: VisibleTranscriptBlock<TValue>[] = [];
  let offset = 0;

  for (const block of blocks) {
    const blockStart = offset;
    const blockEnd = blockStart + block.rowCount;
    offset = blockEnd;

    if (block.rowCount <= 0 || blockEnd <= startRow) {
      continue;
    }
    if (blockStart >= endRow) {
      break;
    }

    visible.push({
      ...block,
      visibleStart: Math.max(0, startRow - blockStart),
      visibleEnd: Math.min(block.rowCount, endRow - blockStart),
    });
  }

  return visible;
}

export function transcriptViewportStatesEqual(
  left: TranscriptViewportState,
  right: TranscriptViewportState,
): boolean {
  return (
    left.scrollTop === right.scrollTop &&
    left.follow === right.follow &&
    left.contentHeight === right.contentHeight &&
    left.viewportHeight === right.viewportHeight &&
    left.width === right.width
  );
}

export function describeTranscriptViewport(
  input: Pick<
    TranscriptViewportState,
    "contentHeight" | "viewportHeight" | "scrollTop" | "follow"
  >,
): TranscriptViewportSummary {
  const normalized = normalizeState(input);
  const maxScroll = getMaxScroll(normalized);
  const overflow = maxScroll > 0;
  const scrollTop = clamp(normalized.scrollTop, 0, maxScroll);
  const rangeStart = normalized.contentHeight === 0 ? 0 : scrollTop + 1;
  const rangeEnd = Math.min(
    normalized.contentHeight,
    scrollTop + normalized.viewportHeight,
  );
  const percent = overflow
    ? Math.round((scrollTop / maxScroll) * 100)
    : normalized.contentHeight === 0
      ? 0
      : 100;

  let edge: TranscriptViewportEdge;
  if (normalized.contentHeight === 0) {
    edge = "empty";
  } else if (!overflow) {
    edge = "fit";
  } else if (scrollTop <= 0) {
    edge = "top";
  } else if (scrollTop >= maxScroll) {
    edge = "bottom";
  } else {
    edge = "middle";
  }

  return {
    contentHeight: normalized.contentHeight,
    viewportHeight: normalized.viewportHeight,
    scrollTop,
    follow: normalized.follow && scrollTop >= maxScroll,
    maxScroll,
    overflow,
    rangeStart,
    rangeEnd,
    percent,
    edge,
  };
}

function normalizeMetrics(
  metrics: TranscriptViewportMetrics,
): TranscriptViewportMetrics {
  return {
    contentHeight: Math.max(0, Math.floor(metrics.contentHeight)),
    viewportHeight: Math.max(0, Math.floor(metrics.viewportHeight)),
    width: Math.max(0, Math.floor(metrics.width)),
  };
}

function normalizeState(
  input: Pick<
    TranscriptViewportState,
    "contentHeight" | "viewportHeight" | "scrollTop" | "follow"
  >,
): Pick<
  TranscriptViewportState,
  "contentHeight" | "viewportHeight" | "scrollTop" | "follow"
> {
  return {
    contentHeight: Math.max(0, Math.floor(input.contentHeight)),
    viewportHeight: Math.max(0, Math.floor(input.viewportHeight)),
    scrollTop: Math.max(0, Math.floor(input.scrollTop)),
    follow: input.follow,
  };
}

function getMaxScroll(
  input: Pick<TranscriptViewportMetrics, "contentHeight" | "viewportHeight">,
): number {
  return Math.max(0, input.contentHeight - input.viewportHeight);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
