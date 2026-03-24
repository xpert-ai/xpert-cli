import { describe, expect, it } from "vitest";
import {
  createViewportState,
  scrollViewportBy,
  scrollViewportToEnd,
  syncViewport,
} from "../ui/viewport.js";

describe("viewport state", () => {
  it("defaults to follow latest and snaps to the bottom when content arrives", () => {
    const state = syncViewport(createViewportState(), {
      contentHeight: 120,
      viewportHeight: 20,
      wrapWidth: 80,
    });

    expect(state.follow).toBe(true);
    expect(state.scrollTop).toBe(100);
  });

  it("leaves follow mode after manual scroll and restores it at the bottom", () => {
    const followed = syncViewport(createViewportState(), {
      contentHeight: 120,
      viewportHeight: 20,
      wrapWidth: 80,
    });
    const scrolled = scrollViewportBy(followed, -10);

    expect(scrolled.follow).toBe(false);
    expect(scrolled.scrollTop).toBe(90);

    const restored = scrollViewportToEnd(scrolled);
    expect(restored.follow).toBe(true);
    expect(restored.scrollTop).toBe(100);
  });

  it("keeps a manual reading position stable when more history arrives", () => {
    const initial = syncViewport(createViewportState(), {
      contentHeight: 120,
      viewportHeight: 20,
      wrapWidth: 80,
    });
    const scrolled = scrollViewportBy(initial, -30);

    const updated = syncViewport(
      scrolled,
      {
        contentHeight: 150,
        viewportHeight: 20,
        wrapWidth: 80,
      },
      "content",
    );

    expect(updated.follow).toBe(false);
    expect(updated.scrollTop).toBe(70);
  });

  it("stays pinned to the bottom after resize when follow mode is active", () => {
    const followed = syncViewport(createViewportState(), {
      contentHeight: 120,
      viewportHeight: 20,
      wrapWidth: 80,
    });

    const resized = syncViewport(
      followed,
      {
        contentHeight: 180,
        viewportHeight: 24,
        wrapWidth: 96,
      },
      "resize",
    );

    expect(resized.follow).toBe(true);
    expect(resized.scrollTop).toBe(156);
  });

  it("keeps a relative reading position on resize when follow mode is off", () => {
    const followed = syncViewport(createViewportState(), {
      contentHeight: 100,
      viewportHeight: 20,
      wrapWidth: 80,
    });
    const scrolled = scrollViewportBy(followed, -40);

    const resized = syncViewport(
      scrolled,
      {
        contentHeight: 200,
        viewportHeight: 20,
        wrapWidth: 96,
      },
      "resize",
    );

    expect(resized.follow).toBe(false);
    expect(resized.scrollTop).toBe(90);
  });
});
