export type InkInspectorMode = "hidden" | "split" | "overlay";

export interface InkColumns {
  inspectorMode: InkInspectorMode;
  contentWidth: number;
  inspectorWidth: number;
}

export interface InkHeights {
  composerHeight: number;
  footerHeight: number;
  permissionHeight: number;
  mainHeight: number;
  conversationHeight: number;
  historyBoxHeight: number;
  pendingBoxHeight: number;
  inspectorBoxHeight: number;
}

const MIN_TERMINAL_WIDTH = 40;
const MIN_TERMINAL_HEIGHT = 8;
const SPLIT_INSPECTOR_BREAKPOINT = 120;
const MIN_MAIN_HEIGHT = 1;
const MIN_HISTORY_BOX_HEIGHT = 1;
const MIN_PENDING_BOX_HEIGHT = 1;
const MAX_PENDING_BOX_HEIGHT = 12;
const MAX_INSPECTOR_BOX_HEIGHT = 14;
const MAX_PERMISSION_HEIGHT = 8;

export function resolveInkColumns(input: {
  terminalWidth: number;
  inspectorOpen: boolean;
}): InkColumns {
  const terminalWidth = Math.max(MIN_TERMINAL_WIDTH, Math.floor(input.terminalWidth));

  if (!input.inspectorOpen) {
    return {
      inspectorMode: "hidden",
      contentWidth: terminalWidth,
      inspectorWidth: 0,
    };
  }

  if (terminalWidth >= SPLIT_INSPECTOR_BREAKPOINT) {
    const inspectorWidth = Math.min(44, Math.max(34, Math.floor(terminalWidth * 0.34)));
    return {
      inspectorMode: "split",
      contentWidth: Math.max(MIN_TERMINAL_WIDTH, terminalWidth - inspectorWidth),
      inspectorWidth,
    };
  }

  return {
    inspectorMode: "overlay",
    contentWidth: terminalWidth,
    inspectorWidth: terminalWidth,
  };
}

export function resolveInkHeights(input: {
  terminalHeight: number;
  permissionVisible: boolean;
  permissionChoiceCount: number;
  inspectorMode: InkInspectorMode;
  inspectorLineCount: number;
  pendingLineCount: number;
}): InkHeights {
  const terminalHeight = Math.max(MIN_TERMINAL_HEIGHT, Math.floor(input.terminalHeight));
  const composerHeight = 1;
  const footerHeight = 1;
  const bottomReserved = composerHeight + footerHeight;
  const maxPermissionHeight = Math.max(
    0,
    terminalHeight - bottomReserved - MIN_MAIN_HEIGHT,
  );
  const permissionHeight = input.permissionVisible
    ? clamp(
        input.permissionChoiceCount + 1,
        Math.min(1, maxPermissionHeight),
        Math.min(MAX_PERMISSION_HEIGHT, maxPermissionHeight),
      )
    : 0;
  const mainHeight = Math.max(
    MIN_MAIN_HEIGHT,
    terminalHeight - bottomReserved - permissionHeight,
  );

  const inspectorBoxHeight =
    input.inspectorMode === "overlay"
      ? clamp(
          input.inspectorLineCount > 0 ? input.inspectorLineCount + 1 : 0,
          0,
          Math.max(0, Math.min(MAX_INSPECTOR_BOX_HEIGHT, mainHeight - MIN_HISTORY_BOX_HEIGHT)),
        )
      : input.inspectorMode === "split"
        ? mainHeight
        : 0;

  const conversationHeight =
    input.inspectorMode === "overlay"
      ? Math.max(MIN_HISTORY_BOX_HEIGHT, mainHeight - inspectorBoxHeight)
      : mainHeight;

  let pendingBoxHeight = 0;
  if (input.pendingLineCount > 0 && conversationHeight > MIN_HISTORY_BOX_HEIGHT) {
    const maxPendingHeight = Math.min(
      MAX_PENDING_BOX_HEIGHT,
      Math.max(MIN_PENDING_BOX_HEIGHT, Math.floor(conversationHeight * 0.4)),
    );
    const maxAllowed = Math.max(
      0,
      conversationHeight - MIN_HISTORY_BOX_HEIGHT,
    );
    if (maxAllowed > 0) {
      pendingBoxHeight = clamp(
        input.pendingLineCount + 1,
        MIN_PENDING_BOX_HEIGHT,
        Math.min(maxPendingHeight, maxAllowed),
      );
    }
  }

  const historyBoxHeight = Math.max(
    MIN_HISTORY_BOX_HEIGHT,
    conversationHeight - pendingBoxHeight,
  );

  if (pendingBoxHeight > 0 && historyBoxHeight + pendingBoxHeight > conversationHeight) {
    pendingBoxHeight = Math.max(
      MIN_PENDING_BOX_HEIGHT,
      conversationHeight - historyBoxHeight,
    );
  }

  const totalHeight =
    composerHeight +
    footerHeight +
    permissionHeight +
    mainHeight;
  if (totalHeight > terminalHeight) {
    throw new Error("Ink height allocation exceeded the terminal height budget");
  }

  return {
    composerHeight,
    footerHeight,
    permissionHeight,
    mainHeight,
    conversationHeight,
    historyBoxHeight,
    pendingBoxHeight,
    inspectorBoxHeight,
  };
}

function clamp(value: number, min: number, max: number): number {
  if (max < min) {
    return max;
  }
  return Math.min(max, Math.max(min, value));
}
