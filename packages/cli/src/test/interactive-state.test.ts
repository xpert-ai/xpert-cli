import { describe, expect, it } from "vitest";
import {
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
    expect(effect.panel?.panel).toBe("status");
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

    expect(toolsEffect.panel?.panel).toBe("tools");
    expect(toolsEffect.historyItem).toBeUndefined();
    expect(sessionEffect.panel?.panel).toBe("session");
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

    expect(effect.panel).toBeNull();
    expect(effect.historyItem).toMatchObject({
      type: "warning",
      text: "Unknown command: /oops",
    });
  });

  it("gives permission prompts higher priority than panel closing on Escape", () => {
    expect(
      resolveEscapeAction({
        permissionActive: true,
        panelOpen: true,
      }),
    ).toBe("deny_permission");
  });

  it("closes the panel on Escape when no permission prompt is active", () => {
    expect(
      resolveEscapeAction({
        permissionActive: false,
        panelOpen: true,
      }),
    ).toBe("close_panel");
  });
});
