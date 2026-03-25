import { describe, expect, it } from "vitest";
import {
  createTranscriptViewportState,
  describeTranscriptViewport,
  getVisibleTranscriptBlocks,
  measureTranscriptBlocks,
  scrollTranscriptViewportBy,
  scrollTranscriptViewportToEnd,
  syncTranscriptViewport,
} from "../ui/transcript-viewport.js";

describe("transcript viewport", () => {
  it("defaults to follow latest and snaps to the bottom when content arrives", () => {
    const state = syncTranscriptViewport(createTranscriptViewportState(), {
      contentHeight: 120,
      viewportHeight: 20,
      width: 80,
    });

    expect(state.follow).toBe(true);
    expect(state.scrollTop).toBe(100);
  });

  it("can start in non-follow mode so overlays open from the top", () => {
    const state = syncTranscriptViewport(
      createTranscriptViewportState({ follow: false }),
      {
        contentHeight: 120,
        viewportHeight: 20,
        width: 80,
      },
    );

    expect(state.follow).toBe(false);
    expect(state.scrollTop).toBe(0);
  });

  it("leaves follow mode after manual scroll and restores it at the bottom", () => {
    const followed = syncTranscriptViewport(createTranscriptViewportState(), {
      contentHeight: 120,
      viewportHeight: 20,
      width: 80,
    });
    const scrolled = scrollTranscriptViewportBy(followed, -10);

    expect(scrolled.follow).toBe(false);
    expect(scrolled.scrollTop).toBe(90);

    const restored = scrollTranscriptViewportToEnd(scrolled);
    expect(restored.follow).toBe(true);
    expect(restored.scrollTop).toBe(100);
  });

  it("keeps a manual reading position stable when more transcript blocks arrive", () => {
    const initial = syncTranscriptViewport(createTranscriptViewportState(), {
      contentHeight: 120,
      viewportHeight: 20,
      width: 80,
    });
    const scrolled = scrollTranscriptViewportBy(initial, -30);

    const updated = syncTranscriptViewport(
      scrolled,
      {
        contentHeight: 150,
        viewportHeight: 20,
        width: 80,
      },
      "content",
    );

    expect(updated.follow).toBe(false);
    expect(updated.scrollTop).toBe(70);
  });

  it("keeps a relative reading position after resize when follow mode is off", () => {
    const followed = syncTranscriptViewport(createTranscriptViewportState(), {
      contentHeight: 100,
      viewportHeight: 20,
      width: 80,
    });
    const scrolled = scrollTranscriptViewportBy(followed, -40);

    const resized = syncTranscriptViewport(
      scrolled,
      {
        contentHeight: 200,
        viewportHeight: 20,
        width: 96,
      },
      "resize",
    );

    expect(resized.follow).toBe(false);
    expect(resized.scrollTop).toBe(90);
  });

  it("computes the visible block window without flattening the whole transcript into one list", () => {
    const measured = measureTranscriptBlocks(
      [
        { id: "a", rows: 4 },
        { id: "b", rows: 6 },
        { id: "c", rows: 5 },
      ],
      {
        getKey: (item) => item.id,
        measure: (item) => item.rows,
      },
    );

    const visible = getVisibleTranscriptBlocks(measured, {
      scrollTop: 3,
      viewportHeight: 6,
    });

    expect(visible.map((block) => [block.key, block.visibleStart, block.visibleEnd])).toEqual([
      ["a", 3, 4],
      ["b", 0, 5],
    ]);
  });

  it("describes top, middle, and bottom positions for scroll indicators", () => {
    const top = describeTranscriptViewport({
      contentHeight: 120,
      viewportHeight: 20,
      scrollTop: 0,
      follow: false,
    });
    const middle = describeTranscriptViewport({
      contentHeight: 120,
      viewportHeight: 20,
      scrollTop: 30,
      follow: false,
    });
    const bottom = describeTranscriptViewport({
      contentHeight: 120,
      viewportHeight: 20,
      scrollTop: 100,
      follow: true,
    });

    expect(top.edge).toBe("top");
    expect(top.percent).toBe(0);
    expect(middle.edge).toBe("middle");
    expect(middle.percent).toBe(30);
    expect(bottom.edge).toBe("bottom");
    expect(bottom.percent).toBe(100);
  });
});
