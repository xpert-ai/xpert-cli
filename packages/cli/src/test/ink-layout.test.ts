import { describe, expect, it } from "vitest";
import {
  resolveInkColumns,
  resolveInkHeights,
} from "../ui/ink-layout.js";
import {
  buildComposerInputLine,
  buildComposerStatusLine,
} from "../ui/ink/composer.js";
import { buildFooterLine } from "../ui/ink/footer.js";
import { buildPermissionPromptLines } from "../ui/ink/permission-prompt.js";

describe("Ink layout helpers", () => {
  it("keeps composer and footer reserved even when pending output is long", () => {
    const heights = resolveInkHeights({
      terminalHeight: 24,
      permissionVisible: false,
      permissionChoiceCount: 0,
      inspectorMode: "hidden",
      inspectorLineCount: 0,
      pendingLineCount: 80,
    });

    expect(heights.composerHeight).toBe(1);
    expect(heights.footerHeight).toBe(1);
    expect(heights.mainHeight).toBe(22);
    expect(heights.pendingBoxHeight).toBeLessThanOrEqual(12);
    expect(heights.historyBoxHeight).toBeGreaterThan(0);
  });

  it("switches between split and overlay inspector layouts based on width", () => {
    const split = resolveInkColumns({
      terminalWidth: 140,
      inspectorOpen: true,
    });
    const overlay = resolveInkColumns({
      terminalWidth: 100,
      inspectorOpen: true,
    });

    expect(split.inspectorMode).toBe("split");
    expect(split.contentWidth).toBeLessThan(140);
    expect(split.inspectorWidth).toBeGreaterThan(0);
    expect(overlay.inspectorMode).toBe("overlay");
    expect(overlay.contentWidth).toBe(100);
  });

  it("reserves space for permission prompts without collapsing the main pane", () => {
    const heights = resolveInkHeights({
      terminalHeight: 18,
      permissionVisible: true,
      permissionChoiceCount: 4,
      inspectorMode: "overlay",
      inspectorLineCount: 12,
      pendingLineCount: 10,
    });

    expect(heights.permissionHeight).toBeGreaterThan(0);
    expect(heights.mainHeight).toBeGreaterThan(0);
    expect(heights.inspectorBoxHeight).toBeGreaterThan(0);
    expect(heights.historyBoxHeight).toBeGreaterThan(0);
  });

  it("keeps the total height budget inside an 8-row terminal with overlay inspector", () => {
    const heights = resolveInkHeights({
      terminalHeight: 8,
      permissionVisible: false,
      permissionChoiceCount: 0,
      inspectorMode: "overlay",
      inspectorLineCount: 20,
      pendingLineCount: 10,
    });

    expect(
      heights.composerHeight +
        heights.footerHeight +
        heights.permissionHeight +
        heights.mainHeight,
    ).toBeLessThanOrEqual(8);
    expect(heights.inspectorBoxHeight).toBeLessThanOrEqual(heights.mainHeight);
    expect(heights.historyBoxHeight + heights.pendingBoxHeight + heights.inspectorBoxHeight).toBe(
      heights.mainHeight,
    );
  });

  it("keeps the total height budget inside an 8-row terminal with permission prompt", () => {
    const heights = resolveInkHeights({
      terminalHeight: 8,
      permissionVisible: true,
      permissionChoiceCount: 4,
      inspectorMode: "overlay",
      inspectorLineCount: 20,
      pendingLineCount: 10,
    });

    expect(
      heights.composerHeight +
        heights.footerHeight +
        heights.permissionHeight +
        heights.mainHeight,
    ).toBeLessThanOrEqual(8);
    expect(heights.permissionHeight).toBe(5);
    expect(heights.mainHeight).toBe(1);
    expect(heights.inspectorBoxHeight).toBe(0);
  });

  it("clips composer output to a single row at narrow widths", () => {
    const idle = buildComposerInputLine({
      width: 40,
      value: "",
    });
    const running = buildComposerStatusLine(40, "waiting for permission... Esc denies, Ctrl+C aborts the turn.");

    expect(Array.from(`${idle.prompt}${idle.body}${idle.cursor}`).length).toBeLessThanOrEqual(40);
    expect(Array.from(running).length).toBeLessThanOrEqual(40);
  });

  it("clips footer output to a single row at narrow widths", () => {
    const footer = buildFooterLine({
      width: 40,
      base: "xpert-cli | very/long/path | s session-1234 | turn running | view scroll | panel status | approval default | git dirty (12 changes)",
      notice: "warning: a very long notice about the latest UI state",
    });

    const rendered = footer.notice ? `${footer.base} | ${footer.notice}` : footer.base;
    expect(Array.from(rendered).length).toBeLessThanOrEqual(40);
  });

  it("renders a compact permission prompt that still fits the allocated rows", () => {
    const lines = buildPermissionPromptLines({
      width: 40,
      height: 5,
      state: {
        message: "Patch wants to run on src/app.ts (modify src/app.ts) [scope: Patch src/app.ts]",
        selectedIndex: 0,
        choices: [
          { title: "Allow once", outcome: "allow_once" },
          { title: "Allow for session", outcome: "allow_session" },
          { title: "Deny once", outcome: "deny" },
          { title: "Deny for session", outcome: "deny_session" },
        ],
      },
    });

    expect(lines).toHaveLength(5);
    expect(lines.every((line) => Array.from(line.text).length <= 40)).toBe(true);
  });
});
