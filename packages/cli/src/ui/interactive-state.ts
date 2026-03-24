import type { UiHistoryItemInput } from "./history.js";
import type { InspectorPanelData, SlashCommandResult } from "./commands.js";

export type EscapeAction = "deny_permission" | "close_panel" | null;

export interface InteractiveSlashCommandEffect {
  shouldExit: boolean;
  panel: InspectorPanelData | null;
  historyItem?: UiHistoryItemInput;
}

export function resolveEscapeAction(input: {
  permissionActive: boolean;
  panelOpen: boolean;
}): EscapeAction {
  if (input.permissionActive) {
    return "deny_permission";
  }

  if (input.panelOpen) {
    return "close_panel";
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
        panel: null,
      };
    case "panel":
      return {
        shouldExit: false,
        panel: result.data,
      };
    case "history":
      return {
        shouldExit: false,
        panel: null,
        historyItem: result.item,
      };
  }
}
