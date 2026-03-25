import type { UiFocusTarget } from "./interactive-state.js";

export type ScrollAction =
  | "line_up"
  | "line_down"
  | "page_up"
  | "page_down"
  | "half_page_up"
  | "half_page_down"
  | "home"
  | "end";

export type ViewportScrollTarget = "transcript" | "overlay";

export interface ViewportScrollResolution {
  target: ViewportScrollTarget;
  action: ScrollAction;
  focusEffect: UiFocusTarget | null;
}

interface ScrollKeyInput {
  upArrow?: boolean;
  downArrow?: boolean;
  pageUp?: boolean;
  pageDown?: boolean;
  home?: boolean;
  end?: boolean;
  ctrl?: boolean;
  meta?: boolean;
}

export function resolveViewportScrollAction(input: {
  value: string;
  key: ScrollKeyInput;
  overlayOpen: boolean;
  focus: UiFocusTarget;
  permissionActive: boolean;
  composerValue: string;
}): ViewportScrollResolution | null {
  if (input.permissionActive) {
    return null;
  }

  if (input.overlayOpen) {
    const action = resolveOverlayScrollAction(input.value, input.key);
    return action
      ? {
          target: "overlay",
          action,
          focusEffect: null,
        }
      : null;
  }

  if (input.focus === "transcript") {
    const action = resolveViewportAction(input.value, input.key, {
      allowArrows: true,
      allowLetters: true,
    });
    return action
      ? {
          target: "transcript",
          action,
          focusEffect: null,
        }
      : null;
  }

  if (input.focus !== "composer") {
    return null;
  }

  const action = resolveViewportAction(input.value, input.key, {
    allowArrows: false,
    allowLetters: input.composerValue.length === 0,
  });
  return action
    ? {
        target: "transcript",
        action,
        focusEffect: "transcript",
      }
    : null;
}

function resolveOverlayScrollAction(
  value: string,
  key: ScrollKeyInput,
): ScrollAction | null {
  return resolveViewportAction(value, key, {
    allowArrows: true,
    allowLetters: true,
  });
}

function resolveViewportAction(
  value: string,
  key: ScrollKeyInput,
  options: {
    allowArrows: boolean;
    allowLetters: boolean;
  },
): ScrollAction | null {
  if (options.allowArrows) {
    if (key.upArrow || value === "k") {
      return "line_up";
    }
    if (key.downArrow || value === "j") {
      return "line_down";
    }
  }

  if (key.pageUp) {
    return "page_up";
  }
  if (key.pageDown) {
    return "page_down";
  }
  if (key.home) {
    return "home";
  }
  if (key.end) {
    return "end";
  }
  if (key.ctrl && (value === "u" || value === "U")) {
    return "half_page_up";
  }
  if (key.ctrl && (value === "d" || value === "D")) {
    return "half_page_down";
  }

  if (!options.allowLetters || key.ctrl || key.meta) {
    return null;
  }

  if (value === "g") {
    return "home";
  }
  if (value === "G") {
    return "end";
  }

  return null;
}
