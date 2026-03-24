export interface ViewportMetrics {
  contentHeight: number;
  viewportHeight: number;
  wrapWidth: number;
}

export interface ViewportState extends ViewportMetrics {
  scrollTop: number;
  follow: boolean;
}

export type ViewportSyncReason = "content" | "resize";

export function createViewportState(): ViewportState {
  return {
    scrollTop: 0,
    follow: true,
    contentHeight: 0,
    viewportHeight: 0,
    wrapWidth: 0,
  };
}

export function syncViewport(
  current: ViewportState,
  nextMetrics: ViewportMetrics,
  reason: ViewportSyncReason = "content",
): ViewportState {
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

export function scrollViewportBy(
  current: ViewportState,
  delta: number,
): ViewportState {
  const nextMaxScroll = getMaxScroll(current);
  const scrollTop = clamp(current.scrollTop + delta, 0, nextMaxScroll);

  return {
    ...current,
    scrollTop,
    follow: scrollTop >= nextMaxScroll,
  };
}

export function scrollViewportToStart(current: ViewportState): ViewportState {
  return {
    ...current,
    scrollTop: 0,
    follow: getMaxScroll(current) === 0,
  };
}

export function scrollViewportToEnd(current: ViewportState): ViewportState {
  return {
    ...current,
    scrollTop: getMaxScroll(current),
    follow: true,
  };
}

export function getViewportMaxScroll(input: Pick<ViewportMetrics, "contentHeight" | "viewportHeight">): number {
  return getMaxScroll(input);
}

export function getViewportRange(
  current: Pick<ViewportState, "scrollTop" | "contentHeight" | "viewportHeight">,
): {
  start: number;
  end: number;
} {
  const start = clamp(current.scrollTop, 0, Math.max(0, current.contentHeight));
  const end = Math.min(current.contentHeight, start + Math.max(0, current.viewportHeight));
  return { start, end };
}

export function viewportStatesEqual(
  left: ViewportState,
  right: ViewportState,
): boolean {
  return (
    left.scrollTop === right.scrollTop &&
    left.follow === right.follow &&
    left.contentHeight === right.contentHeight &&
    left.viewportHeight === right.viewportHeight &&
    left.wrapWidth === right.wrapWidth
  );
}

function normalizeMetrics(metrics: ViewportMetrics): ViewportMetrics {
  return {
    contentHeight: Math.max(0, Math.floor(metrics.contentHeight)),
    viewportHeight: Math.max(0, Math.floor(metrics.viewportHeight)),
    wrapWidth: Math.max(0, Math.floor(metrics.wrapWidth)),
  };
}

function getMaxScroll(input: Pick<ViewportMetrics, "contentHeight" | "viewportHeight">): number {
  return Math.max(0, input.contentHeight - input.viewportHeight);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
