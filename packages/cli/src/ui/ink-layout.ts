export interface InkHeights {
  headerHeight: number;
  statusRowHeight: number;
  composerHeight: number;
  permissionHeight: number;
  mainHeight: number;
}

const MIN_MAIN_HEIGHT = 1;
const MAX_PERMISSION_HEIGHT = 8;

export function resolveInkHeights(input: {
  terminalHeight: number;
  permissionVisible: boolean;
  permissionChoiceCount: number;
}): InkHeights {
  const terminalHeight = Math.max(1, Math.floor(input.terminalHeight));
  let remaining = terminalHeight;

  const composerHeight = remaining > 0 ? 1 : 0;
  remaining -= composerHeight;

  const mainReservation = remaining > 0 ? MIN_MAIN_HEIGHT : 0;
  remaining -= mainReservation;

  const permissionHeight = input.permissionVisible
    ? Math.min(
        Math.min(MAX_PERMISSION_HEIGHT, Math.max(1, input.permissionChoiceCount + 1)),
        remaining,
      )
    : 0;
  remaining -= permissionHeight;

  const statusRowHeight = remaining > 0 ? 1 : 0;
  remaining -= statusRowHeight;

  const headerHeight = remaining > 0 ? 1 : 0;
  remaining -= headerHeight;

  const mainHeight = mainReservation + remaining;

  const totalHeight =
    headerHeight +
    statusRowHeight +
    composerHeight +
    permissionHeight +
    mainHeight;
  if (totalHeight > terminalHeight) {
    throw new Error("Ink height allocation exceeded the terminal height budget");
  }

  return {
    headerHeight,
    statusRowHeight,
    composerHeight,
    permissionHeight,
    mainHeight,
  };
}
