import { describe, expect, it } from "vitest";
import {
  buildStatusRowText,
  deriveStatusRowModel,
  formatElapsed,
} from "../ui/ink/status-row.js";
import { stringDisplayWidth } from "../ui/display-width.js";

describe("status row", () => {
  it("renders a running state with elapsed time and abort hint", () => {
    const model = deriveStatusRowModel({
      turnState: "running",
      pendingBlocks: [
        {
          id: "tool-1",
          kind: "tool_group",
          toolName: "Bash",
          status: "running",
        },
      ],
      elapsedMs: 12_000,
      spinnerFrame: "◐",
    });

    expect(model.badge).toBe("[◐]");
    expect(model.action).toBe("Bash");
    expect(model.elapsed).toBe("12s");
    expect(model.hint).toContain("Ctrl+C aborts");
  });

  it("renders permission waits with deny and abort hints", () => {
    const model = deriveStatusRowModel({
      turnState: "waiting_permission",
      pendingBlocks: [],
      elapsedMs: 7_000,
      spinnerFrame: "◓",
    });

    expect(model.action).toBe("Waiting for permission");
    expect(model.hint).toContain("Esc denies");
    expect(model.hint).toContain("Ctrl+C aborts");
  });

  it("renders idle inline history hints and clips safely in narrow terminals", () => {
    const model = deriveStatusRowModel({
      turnState: "idle",
      pendingBlocks: [],
      elapsedMs: 0,
      notice: {
        level: "warning",
        message: "a very long warning about the latest runtime state",
      },
      spinnerFrame: "◑",
    });
    const line = buildStatusRowText({
      width: 40,
      model,
    });

    expect(model.action).toBe("Ready");
    expect(model.hint).toContain("Scrollback keeps history");
    expect(stringDisplayWidth(line)).toBeLessThanOrEqual(40);
  });

  it("keeps mixed cjk and emoji permission waits on one line", () => {
    const model = deriveStatusRowModel({
      turnState: "waiting_permission",
      pendingBlocks: [
        {
          id: "tool-1",
          kind: "tool_group",
          toolName: "Patch🧪",
          target: "src/中文-app.ts",
          status: "waiting_permission",
        },
      ],
      elapsedMs: 8_000,
      notice: {
        level: "warning",
        message: "需要确认 👨‍👩‍👧‍👦 patch 范围是否安全",
      },
      spinnerFrame: "◒",
    });
    const line = buildStatusRowText({
      width: 28,
      model,
    });

    expect(model.action).toContain("Patch🧪");
    expect(line.startsWith("[WAIT]")).toBe(true);
    expect(stringDisplayWidth(line)).toBeLessThanOrEqual(28);
  });

  it("clips long running actions with unicode notice content safely", () => {
    const line = buildStatusRowText({
      width: 24,
      model: {
        badge: "[◐]",
        action: "读取 README 👩🏽‍💻 处理中",
        elapsed: "12s",
        hint: "Ctrl+C aborts",
        notice: "中文 notice ✅",
        noticeLabel: "note",
        level: "info",
      },
    });

    expect(stringDisplayWidth(line)).toBeLessThanOrEqual(24);
    expect(line.includes("\u001B")).toBe(false);
  });

  it("formats long elapsed times compactly", () => {
    expect(formatElapsed(59_000)).toBe("59s");
    expect(formatElapsed(61_000)).toBe("1m 01s");
    expect(formatElapsed(3_726_000)).toBe("1h 02m 06s");
  });
});
