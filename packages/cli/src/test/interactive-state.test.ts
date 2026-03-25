import { describe, expect, it } from "vitest";
import {
  closeOverlay,
  createInteractiveUiState,
  cyclePrimaryFocus,
  openOverlay,
  resolveEscapeAction,
  resolveInteractiveSlashCommandEffect,
} from "../ui/interactive-state.js";

describe("interactive UI state helpers", () => {
  it("opens the status panel without appending to history", () => {
    const effect = resolveInteractiveSlashCommandEffect({
      type: "panel",
      panel: "status",
      data: {
        panel: "status",
        title: "Status",
        sections: [{ title: "Runtime", lines: ["cwd: /tmp/project"] }],
      },
    });

    expect(effect.shouldExit).toBe(false);
    expect(effect.overlay?.panel).toBe("status");
    expect(effect.historyItem).toBeUndefined();
  });

  it("opens the tools and session panels without polluting transcript history", () => {
    const toolsEffect = resolveInteractiveSlashCommandEffect({
      type: "panel",
      panel: "tools",
      data: {
        panel: "tools",
        title: "Tools",
        sections: [{ title: "Available Tools", lines: ["- Read"] }],
      },
    });
    const sessionEffect = resolveInteractiveSlashCommandEffect({
      type: "panel",
      panel: "session",
      data: {
        panel: "session",
        title: "Session",
        sections: [{ title: "Recent Turns", lines: ["No turns recorded yet."] }],
      },
    });

    expect(toolsEffect.overlay?.panel).toBe("tools");
    expect(toolsEffect.historyItem).toBeUndefined();
    expect(sessionEffect.overlay?.panel).toBe("session");
    expect(sessionEffect.historyItem).toBeUndefined();
  });

  it("keeps history output for non-panel slash command results", () => {
    const effect = resolveInteractiveSlashCommandEffect({
      type: "history",
      item: {
        type: "warning",
        text: "Unknown command: /oops",
      },
    });

    expect(effect.overlay).toBeNull();
    expect(effect.historyItem).toMatchObject({
      type: "warning",
      text: "Unknown command: /oops",
    });
  });

  it("cycles focus between composer and transcript when no overlay is open", () => {
    const transcript = cyclePrimaryFocus(createInteractiveUiState());
    const composer = cyclePrimaryFocus(transcript);

    expect(transcript.focus).toBe("transcript");
    expect(composer.focus).toBe("composer");
  });

  it("restores the previous focus after closing an overlay", () => {
    const base = cyclePrimaryFocus(createInteractiveUiState());
    const opened = openOverlay(base, {
      panel: "status",
      title: "Status",
      sections: [],
    });
    const closed = closeOverlay(opened);

    expect(opened.focus).toBe("overlay");
    expect(closed.focus).toBe("transcript");
    expect(closed.overlay).toBeNull();
  });

  it("gives permission prompts higher priority than panel closing on Escape", () => {
    expect(
      resolveEscapeAction({
        permissionActive: true,
        overlayOpen: true,
        focus: "overlay",
        transcriptFollow: true,
      }),
    ).toBe("deny_permission");
  });

  it("closes the overlay on Escape when no permission prompt is active", () => {
    expect(
      resolveEscapeAction({
        permissionActive: false,
        overlayOpen: true,
        focus: "overlay",
        transcriptFollow: true,
      }),
    ).toBe("close_overlay");
  });

  it("returns the transcript to the composer and follow mode on Escape", () => {
    expect(
      resolveEscapeAction({
        permissionActive: false,
        overlayOpen: false,
        focus: "transcript",
        transcriptFollow: false,
      }),
    ).toBe("focus_composer_and_follow");
  });
});
