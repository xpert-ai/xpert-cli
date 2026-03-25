import { describe, expect, it } from "vitest";
import {
  buildStatusRowText,
  deriveStatusRowModel,
  formatElapsed,
} from "../ui/ink/status-row.js";

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

    expect(model.action).toBe("Running Bash");
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
    expect(model.hint).toContain("Terminal scrollback keeps history");
    expect(Array.from(line).length).toBeLessThanOrEqual(40);
  });

  it("formats long elapsed times compactly", () => {
    expect(formatElapsed(59_000)).toBe("59s");
    expect(formatElapsed(61_000)).toBe("1m 01s");
    expect(formatElapsed(3_726_000)).toBe("1h 02m 06s");
  });
});
