import type { UiHistoryItemInput } from "./history.js";
import type { InspectorPanelData, SlashCommandResult } from "./commands.js";

export type UiFocusTarget = "composer" | "transcript" | "overlay";

export interface InteractiveUiState {
  focus: UiFocusTarget;
  overlay: InspectorPanelData | null;
  lastNonOverlayFocus: Exclude<UiFocusTarget, "overlay">;
}

export type EscapeAction =
  | "deny_permission"
  | "close_overlay"
  | "focus_composer"
  | "focus_composer_and_follow"
  | null;

export interface InteractiveSlashCommandEffect {
  shouldExit: boolean;
  overlay: InspectorPanelData | null;
  historyItem?: UiHistoryItemInput;
}

export function createInteractiveUiState(): InteractiveUiState {
  return {
    focus: "composer",
    overlay: null,
    lastNonOverlayFocus: "composer",
  };
}

export function focusComposer(state: InteractiveUiState): InteractiveUiState {
  return {
    ...state,
    focus: "composer",
    lastNonOverlayFocus: "composer",
  };
}

export function focusTranscript(state: InteractiveUiState): InteractiveUiState {
  return {
    ...state,
    focus: "transcript",
    lastNonOverlayFocus: "transcript",
  };
}

export function cyclePrimaryFocus(state: InteractiveUiState): InteractiveUiState {
  if (state.overlay) {
    return state;
  }

  return state.focus === "composer"
    ? focusTranscript(state)
    : focusComposer(state);
}

export function openOverlay(
  state: InteractiveUiState,
  overlay: InspectorPanelData,
): InteractiveUiState {
  const lastNonOverlayFocus =
    state.focus === "overlay" ? state.lastNonOverlayFocus : state.focus;

  return {
    focus: "overlay",
    overlay,
    lastNonOverlayFocus,
  };
}

export function closeOverlay(state: InteractiveUiState): InteractiveUiState {
  return {
    focus: state.lastNonOverlayFocus,
    overlay: null,
    lastNonOverlayFocus: state.lastNonOverlayFocus,
  };
}

export function resolveEscapeAction(input: {
  permissionActive: boolean;
  overlayOpen: boolean;
  focus: UiFocusTarget;
  transcriptFollow: boolean;
}): EscapeAction {
  if (input.permissionActive) {
    return "deny_permission";
  }

  if (input.overlayOpen) {
    return "close_overlay";
  }

  if (input.focus === "transcript") {
    return input.transcriptFollow
      ? "focus_composer"
      : "focus_composer_and_follow";
  }

  return null;
}

export function resolveInteractiveSlashCommandEffect(
  result: SlashCommandResult,
): InteractiveSlashCommandEffect {
  switch (result.type) {
    case "exit":
      return {
        shouldExit: true,
        overlay: null,
      };
    case "panel":
      return {
        shouldExit: false,
        overlay: result.data,
      };
    case "history":
      return {
        shouldExit: false,
        overlay: null,
        historyItem: result.item,
      };
  }
}
