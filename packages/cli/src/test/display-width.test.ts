import { describe, expect, it } from "vitest";
import {
  stringDisplayWidth,
  stripAnsi,
  truncateDisplayWidth,
  wrapDisplayWidth,
} from "../ui/display-width.js";

describe("display width helpers", () => {
  it("measures mixed latin and full-width text with terminal semantics", () => {
    expect(stringDisplayWidth("abc中文")).toBe(7);
    expect(stringDisplayWidth("工具 ✅")).toBeGreaterThanOrEqual(6);
  });

  it("strips ansi escapes before measuring and clipping", () => {
    const colored = "\u001B[31merror\u001B[39m";
    expect(stripAnsi(colored)).toBe("error");
    expect(stringDisplayWidth(colored)).toBe(5);
    expect(truncateDisplayWidth(colored, 4)).toBe("err…");
  });

  it("truncates from either side without breaking terminal width", () => {
    expect(truncateDisplayWidth("hello世界", 6)).toBe("hello…");
    expect(truncateDisplayWidth("hello世界", 6, { position: "start" })).toBe("…o世界");
  });

  it("wraps by display width instead of raw string length", () => {
    expect(wrapDisplayWidth("ab中文cd", 4)).toEqual(["ab中", "文cd"]);
    expect(wrapDisplayWidth("status", 10)).toEqual(["status"]);
  });

  it("never returns a wrapped segment wider than the requested width", () => {
    const widthOneCases = [
      wrapDisplayWidth("中a", 1),
      wrapDisplayWidth("✅a", 1),
      wrapDisplayWidth("😀a", 1),
    ];

    expect(widthOneCases).toEqual([["…", "a"], ["…", "a"], ["…", "a"]]);
    for (const lines of widthOneCases) {
      expect(lines.every((line) => stringDisplayWidth(line) <= 1)).toBe(true);
    }

    const widthTwoCases = [
      wrapDisplayWidth("中a", 2),
      wrapDisplayWidth("✅a", 2),
      wrapDisplayWidth("😀a", 2),
    ];

    expect(widthTwoCases).toEqual([["中", "a"], ["✅", "a"], ["😀", "a"]]);
    for (const lines of widthTwoCases) {
      expect(lines.every((line) => stringDisplayWidth(line) <= 2)).toBe(true);
    }
  });
});
