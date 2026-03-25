import { describe, expect, it } from "vitest";
import {
  stringDisplayWidth,
  stripAnsi,
  takeHeadDisplayWidthChunk,
  truncateDisplayWidth,
  wrapDisplayWidth,
} from "../ui/display-width.js";

describe("display width helpers", () => {
  it("measures latin, cjk, combining, emoji, and variation-selector clusters", () => {
    expect(stringDisplayWidth("plain text")).toBe(10);
    expect(stringDisplayWidth("abc中文")).toBe(7);
    expect(stringDisplayWidth("Cafe\u0301")).toBe(4);
    expect(stringDisplayWidth("™")).toBe(1);
    expect(stringDisplayWidth("™️")).toBe(2);
    expect(stringDisplayWidth("👨‍👩‍👧‍👦")).toBe(2);
    expect(stringDisplayWidth("工具 ✅")).toBe(7);
  });

  it("strips ansi escapes before measuring and clipping", () => {
    const colored = "\u001B[31m中👩🏽‍💻Cafe\u0301\u001B[39m";
    expect(stripAnsi(colored)).toBe("中👩🏽‍💻Cafe\u0301");
    expect(stringDisplayWidth(colored)).toBe(8);
    expect(truncateDisplayWidth(colored, 5)).toBe("中👩🏽‍💻…");
  });

  it("truncates from either side without breaking grapheme clusters", () => {
    expect(truncateDisplayWidth("hello世界", 6)).toBe("hello…");
    expect(truncateDisplayWidth("hello世界", 6, { position: "start" })).toBe("…o世界");
    expect(truncateDisplayWidth("ab👨‍👩‍👧‍👦中cd", 6)).toBe("ab👨‍👩‍👧‍👦…");
    expect(truncateDisplayWidth("ab👨‍👩‍👧‍👦中cd", 6, { position: "start" })).toBe("…中cd");
    expect(truncateDisplayWidth("Cafe\u0301世界", 6)).toBe("Cafe\u0301…");
  });

  it("wraps by display width instead of raw string length", () => {
    expect(wrapDisplayWidth("ab中文cd", 4)).toEqual(["ab中", "文cd"]);
    expect(wrapDisplayWidth("status", 10)).toEqual(["status"]);
    expect(wrapDisplayWidth("A👩🏽‍💻中B", 4)).toEqual(["A👩🏽‍💻", "中B"]);
    expect(wrapDisplayWidth("\u001B[31m中👨‍👩‍👧‍👦a\u001B[39m", 3)).toEqual([
      "中",
      "👨‍👩‍👧‍👦a",
    ]);
  });

  it("returns head chunks on grapheme boundaries", () => {
    expect(takeHeadDisplayWidthChunk("👨‍👩‍👧‍👦abc", 2)).toEqual({
      segment: "👨‍👩‍👧‍👦",
      consumedLength: "👨‍👩‍👧‍👦".length,
    });
    expect(takeHeadDisplayWidthChunk("👨‍👩‍👧‍👦abc", 1)).toEqual({
      segment: "…",
      consumedLength: "👨‍👩‍👧‍👦".length,
    });
    expect(takeHeadDisplayWidthChunk("Cafe\u0301世界", 4)).toEqual({
      segment: "Cafe\u0301",
      consumedLength: "Cafe\u0301".length,
    });
  });

  it("never returns a segment wider than the requested width", () => {
    const widthOneCases = [
      wrapDisplayWidth("中a", 1),
      wrapDisplayWidth("✅a", 1),
      wrapDisplayWidth("😀a", 1),
      wrapDisplayWidth("👨‍👩‍👧‍👦a", 1),
    ];

    expect(widthOneCases).toEqual([
      ["…", "a"],
      ["…", "a"],
      ["…", "a"],
      ["…", "a"],
    ]);
    for (const lines of widthOneCases) {
      expect(lines.every((line) => stringDisplayWidth(line) <= 1)).toBe(true);
    }

    const widthTwoCases = [
      wrapDisplayWidth("中a", 2),
      wrapDisplayWidth("✅a", 2),
      wrapDisplayWidth("😀a", 2),
      wrapDisplayWidth("👨‍👩‍👧‍👦a", 2),
    ];

    expect(widthTwoCases).toEqual([
      ["中", "a"],
      ["✅", "a"],
      ["😀", "a"],
      ["👨‍👩‍👧‍👦", "a"],
    ]);
    for (const lines of widthTwoCases) {
      expect(lines.every((line) => stringDisplayWidth(line) <= 2)).toBe(true);
    }

    const chunk = takeHeadDisplayWidthChunk("✈️中", 2);
    expect(stringDisplayWidth(chunk.segment)).toBeLessThanOrEqual(2);
    expect(
      wrapDisplayWidth("Cafe\u0301👩🏽‍💻中文", 4).every(
        (line) => stringDisplayWidth(line) <= 4,
      ),
    ).toBe(true);
  });
});
