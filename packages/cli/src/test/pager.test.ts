import { describe, expect, it } from "vitest";
import {
  buildPagerScrollbarRows,
  formatPagerHeader,
} from "../ui/ink/pager.js";

describe("pager chrome", () => {
  it("omits the scrollbar when content fits", () => {
    const rows = buildPagerScrollbarRows({
      viewportHeight: 12,
      summary: {
        contentHeight: 8,
        viewportHeight: 12,
        scrollTop: 0,
        follow: true,
        maxScroll: 0,
        overflow: false,
        rangeStart: 1,
        rangeEnd: 8,
        percent: 100,
        edge: "fit",
      },
    });

    expect(rows).toEqual([]);
  });

  it("renders distinct top, middle, and bottom thumb positions", () => {
    const top = buildPagerScrollbarRows({
      viewportHeight: 10,
      summary: {
        contentHeight: 40,
        viewportHeight: 10,
        scrollTop: 0,
        follow: false,
        maxScroll: 30,
        overflow: true,
        rangeStart: 1,
        rangeEnd: 10,
        percent: 0,
        edge: "top",
      },
    });
    const middle = buildPagerScrollbarRows({
      viewportHeight: 10,
      summary: {
        contentHeight: 40,
        viewportHeight: 10,
        scrollTop: 15,
        follow: false,
        maxScroll: 30,
        overflow: true,
        rangeStart: 16,
        rangeEnd: 25,
        percent: 50,
        edge: "middle",
      },
    });
    const bottom = buildPagerScrollbarRows({
      viewportHeight: 10,
      summary: {
        contentHeight: 40,
        viewportHeight: 10,
        scrollTop: 30,
        follow: false,
        maxScroll: 30,
        overflow: true,
        rangeStart: 31,
        rangeEnd: 40,
        percent: 100,
        edge: "bottom",
      },
    });

    expect(top.slice(0, 2).every((row) => row.tone === "thumb")).toBe(true);
    expect(middle[0]?.tone).toBe("track");
    expect(middle.some((row, index) => index > 0 && row.tone === "thumb")).toBe(true);
    expect(bottom.at(-1)?.tone).toBe("thumb");
  });

  it("keeps the header on one line and includes range plus live/scroll state", () => {
    const live = formatPagerHeader({
      title: "Transcript",
      focused: true,
      summary: {
        contentHeight: 120,
        viewportHeight: 20,
        scrollTop: 100,
        follow: true,
        maxScroll: 100,
        overflow: true,
        rangeStart: 101,
        rangeEnd: 120,
        percent: 100,
        edge: "bottom",
      },
      width: 80,
    });
    const narrow = formatPagerHeader({
      title: "Session",
      focused: false,
      summary: {
        contentHeight: 120,
        viewportHeight: 20,
        scrollTop: 24,
        follow: false,
        maxScroll: 100,
        overflow: true,
        rangeStart: 25,
        rangeEnd: 44,
        percent: 24,
        edge: "middle",
      },
      width: 24,
    });

    expect(live).toContain("live");
    expect(live).toContain("101-120/120");
    expect(Array.from(narrow).length).toBeLessThanOrEqual(24);
  });
});
