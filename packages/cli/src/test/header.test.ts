import { describe, expect, it } from "vitest";
import { buildHeaderLine, buildViewportLabel } from "../ui/ink/header.js";

describe("header", () => {
  it("shows transcript live state when follow mode is on", () => {
    const label = buildViewportLabel({
      overlayPanel: null,
      transcriptViewport: {
        contentHeight: 120,
        viewportHeight: 20,
        scrollTop: 100,
        follow: true,
      },
      overlayViewport: {
        contentHeight: 0,
        viewportHeight: 0,
        scrollTop: 0,
        follow: false,
      },
    });

    expect(label).toBe("transcript live 101-120/120");
  });

  it("shows overlay range state while a panel is open", () => {
    const label = buildViewportLabel({
      overlayPanel: "session",
      transcriptViewport: {
        contentHeight: 120,
        viewportHeight: 20,
        scrollTop: 100,
        follow: true,
      },
      overlayViewport: {
        contentHeight: 120,
        viewportHeight: 20,
        scrollTop: 0,
        follow: false,
      },
    });

    expect(label).toBe("overlay session top 1-20/120");
  });

  it("clips the full header to a single row in narrow terminals", () => {
    const line = buildHeaderLine({
      width: 40,
      parts: [
        "xpert-cli",
        "repo",
        "s abcdef12",
        "transcript scroll 42% 21-40/120",
        "focus transcript",
        "asst local-agent",
      ],
    });

    expect(Array.from(line).length).toBeLessThanOrEqual(40);
  });
});
