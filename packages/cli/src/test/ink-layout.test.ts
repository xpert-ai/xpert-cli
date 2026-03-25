import { describe, expect, it } from "vitest";
import {
  resolveInkHeights,
} from "../ui/ink-layout.js";
import {
  buildComposerInputLine,
  buildComposerStatusLine,
} from "../ui/ink/composer.js";
import { buildPermissionPromptLines } from "../ui/ink/permission-prompt.js";
import { stringDisplayWidth } from "../ui/display-width.js";

describe("Ink layout helpers", () => {
  it("keeps header, status row, and composer reserved inside the height budget", () => {
    const heights = resolveInkHeights({
      terminalHeight: 24,
      permissionVisible: false,
      permissionChoiceCount: 0,
    });

    expect(heights.headerHeight).toBe(1);
    expect(heights.statusRowHeight).toBe(1);
    expect(heights.composerHeight).toBe(1);
    expect(heights.mainHeight).toBe(21);
  });

  it("reserves space for permission prompts without collapsing the transcript", () => {
    const heights = resolveInkHeights({
      terminalHeight: 18,
      permissionVisible: true,
      permissionChoiceCount: 4,
    });

    expect(heights.permissionHeight).toBeGreaterThan(0);
    expect(heights.mainHeight).toBeGreaterThan(0);
  });

  it("keeps the total height budget inside an 8-row terminal", () => {
    const heights = resolveInkHeights({
      terminalHeight: 8,
      permissionVisible: false,
      permissionChoiceCount: 0,
    });

    expect(
      heights.headerHeight +
        heights.statusRowHeight +
        heights.composerHeight +
        heights.permissionHeight +
        heights.mainHeight,
    ).toBeLessThanOrEqual(8);
  });

  it("keeps the total height budget inside an 8-row terminal with permission prompt", () => {
    const heights = resolveInkHeights({
      terminalHeight: 8,
      permissionVisible: true,
      permissionChoiceCount: 4,
    });

    expect(
      heights.headerHeight +
        heights.statusRowHeight +
        heights.composerHeight +
        heights.permissionHeight +
        heights.mainHeight,
    ).toBeLessThanOrEqual(8);
    expect(heights.headerHeight).toBe(0);
    expect(heights.permissionHeight).toBe(5);
    expect(heights.mainHeight).toBe(1);
  });

  it("fits inside a very small terminal without inventing a larger virtual canvas", () => {
    const heights = resolveInkHeights({
      terminalHeight: 3,
      permissionVisible: false,
      permissionChoiceCount: 0,
    });

    expect(
      heights.headerHeight +
        heights.statusRowHeight +
        heights.composerHeight +
        heights.permissionHeight +
        heights.mainHeight,
    ).toBeLessThanOrEqual(3);
    expect(heights.headerHeight).toBe(0);
    expect(heights.statusRowHeight).toBe(1);
    expect(heights.composerHeight).toBe(1);
    expect(heights.mainHeight).toBe(1);
  });

  it("clips composer output to a single row at narrow widths", () => {
    const idle = buildComposerInputLine({
      width: 40,
      value: "",
      focused: true,
    });
    const running = buildComposerStatusLine(
      40,
      "[RUNNING] Turn active · Ctrl+C aborts",
    );

    expect(idle.badge).toBe("[READY] ");
    expect(
      stringDisplayWidth(`${idle.badge}${idle.prompt}${idle.body}${idle.cursor}`),
    ).toBeLessThanOrEqual(40);
    expect(stringDisplayWidth(running)).toBeLessThanOrEqual(40);
  });

  it("renders a compact permission prompt that still fits the allocated rows", () => {
    const lines = buildPermissionPromptLines({
      width: 40,
      height: 5,
      state: {
        message: "Patch wants to run on src/app.ts (modify src/app.ts) [scope: Patch src/app.ts]",
        toolName: "Patch",
        riskLevel: "moderate",
        target: "src/app.ts",
        reason: "modify src/app.ts",
        scope: "Patch src/app.ts",
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
    expect(lines[0]?.text).toContain("Permission · Patch · moderate");
    expect(lines[0]?.text.endsWith("…")).toBe(true);
    expect(lines.at(-1)?.text).toBe("  Deny for session");
    expect(lines.some((line) => line.text.includes("Enter confirms"))).toBe(false);
    expect(lines.every((line) => stringDisplayWidth(line.text) <= 40)).toBe(true);
  });
});
