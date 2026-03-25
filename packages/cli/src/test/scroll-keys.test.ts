import { describe, expect, it } from "vitest";
import { resolveViewportScrollAction } from "../ui/scroll-keys.js";

describe("scroll key resolver", () => {
  it("routes explicit scroll keys from the composer to the transcript", () => {
    const pageUp = resolveViewportScrollAction({
      value: "",
      key: { pageUp: true },
      overlayOpen: false,
      focus: "composer",
      permissionActive: false,
      composerValue: "",
    });
    const pageDown = resolveViewportScrollAction({
      value: "",
      key: { pageDown: true },
      overlayOpen: false,
      focus: "composer",
      permissionActive: false,
      composerValue: "",
    });
    const home = resolveViewportScrollAction({
      value: "",
      key: { home: true },
      overlayOpen: false,
      focus: "composer",
      permissionActive: false,
      composerValue: "",
    });
    const end = resolveViewportScrollAction({
      value: "",
      key: { end: true },
      overlayOpen: false,
      focus: "composer",
      permissionActive: false,
      composerValue: "",
    });
    const halfUp = resolveViewportScrollAction({
      value: "u",
      key: { ctrl: true },
      overlayOpen: false,
      focus: "composer",
      permissionActive: false,
      composerValue: "",
    });
    const halfDown = resolveViewportScrollAction({
      value: "d",
      key: { ctrl: true },
      overlayOpen: false,
      focus: "composer",
      permissionActive: false,
      composerValue: "",
    });
    const g = resolveViewportScrollAction({
      value: "g",
      key: {},
      overlayOpen: false,
      focus: "composer",
      permissionActive: false,
      composerValue: "",
    });
    const G = resolveViewportScrollAction({
      value: "G",
      key: {},
      overlayOpen: false,
      focus: "composer",
      permissionActive: false,
      composerValue: "",
    });

    expect(pageUp).toEqual({
      target: "transcript",
      action: "page_up",
      focusEffect: "transcript",
    });
    expect(pageDown).toEqual({
      target: "transcript",
      action: "page_down",
      focusEffect: "transcript",
    });
    expect(home?.action).toBe("home");
    expect(end?.action).toBe("end");
    expect(halfUp?.action).toBe("half_page_up");
    expect(halfDown?.action).toBe("half_page_down");
    expect(g?.action).toBe("home");
    expect(G?.action).toBe("end");
  });

  it("keeps Up and Down in the composer for input history", () => {
    expect(
      resolveViewportScrollAction({
        value: "",
        key: { upArrow: true },
        overlayOpen: false,
        focus: "composer",
        permissionActive: false,
        composerValue: "",
      }),
    ).toBeNull();
    expect(
      resolveViewportScrollAction({
        value: "",
        key: { downArrow: true },
        overlayOpen: false,
        focus: "composer",
        permissionActive: false,
        composerValue: "",
      }),
    ).toBeNull();
  });

  it("does not steal g or G once the composer already has text", () => {
    expect(
      resolveViewportScrollAction({
        value: "g",
        key: {},
        overlayOpen: false,
        focus: "composer",
        permissionActive: false,
        composerValue: "gi",
      }),
    ).toBeNull();
    expect(
      resolveViewportScrollAction({
        value: "G",
        key: {},
        overlayOpen: false,
        focus: "composer",
        permissionActive: false,
        composerValue: "Go",
      }),
    ).toBeNull();
  });

  it("routes overlay scroll keys to the overlay pager", () => {
    const pageUp = resolveViewportScrollAction({
      value: "",
      key: { pageUp: true },
      overlayOpen: true,
      focus: "composer",
      permissionActive: false,
      composerValue: "",
    });
    const home = resolveViewportScrollAction({
      value: "g",
      key: {},
      overlayOpen: true,
      focus: "overlay",
      permissionActive: false,
      composerValue: "",
    });
    const end = resolveViewportScrollAction({
      value: "G",
      key: {},
      overlayOpen: true,
      focus: "overlay",
      permissionActive: false,
      composerValue: "",
    });

    expect(pageUp?.target).toBe("overlay");
    expect(home?.action).toBe("home");
    expect(end?.action).toBe("end");
  });

  it("keeps permission prompts in control of the keyboard", () => {
    expect(
      resolveViewportScrollAction({
        value: "",
        key: { pageUp: true },
        overlayOpen: true,
        focus: "overlay",
        permissionActive: true,
        composerValue: "",
      }),
    ).toBeNull();
  });

  it("supports j/k line scroll when a viewport already owns focus", () => {
    const up = resolveViewportScrollAction({
      value: "k",
      key: {},
      overlayOpen: false,
      focus: "transcript",
      permissionActive: false,
      composerValue: "",
    });
    const down = resolveViewportScrollAction({
      value: "j",
      key: {},
      overlayOpen: true,
      focus: "overlay",
      permissionActive: false,
      composerValue: "",
    });

    expect(up?.action).toBe("line_up");
    expect(down?.action).toBe("line_down");
  });
});
