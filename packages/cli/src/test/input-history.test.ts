import { describe, expect, it } from "vitest";
import { createInputHistoryController } from "../ui/input-history.js";

describe("createInputHistoryController", () => {
  it("walks backward and forward through submitted history while restoring the draft", () => {
    const history = createInputHistoryController();
    history.push("first prompt");
    history.push("second prompt");

    expect(history.previous("draft in progress")).toBe("second prompt");
    expect(history.previous("ignored current draft")).toBe("first prompt");
    expect(history.next("ignored current draft")).toBe("second prompt");
    expect(history.next("ignored current draft")).toBe("draft in progress");
    expect(history.isBrowsing()).toBe(false);
  });

  it("ignores empty values and adjacent duplicates on submit", () => {
    const history = createInputHistoryController();
    history.push("");
    history.push("   ");
    history.push("same prompt");
    history.push("same prompt");
    history.push("different prompt");

    expect(history.previous("draft")).toBe("different prompt");
    expect(history.previous("draft")).toBe("same prompt");
    expect(history.previous("draft")).toBe("same prompt");
  });

  it("resets browsing state when the current input starts being edited again", () => {
    const history = createInputHistoryController();
    history.push("/status");
    history.push("summarize README.md");

    expect(history.previous("draft")).toBe("summarize README.md");
    expect(history.isBrowsing()).toBe(true);

    history.resetBrowsing();

    expect(history.isBrowsing()).toBe(false);
    expect(history.next("edited prompt")).toBe("edited prompt");
  });

  it("resets browsing state after submit and starts from the newest entry again", () => {
    const history = createInputHistoryController();
    history.push("older");
    expect(history.previous("draft")).toBe("older");

    history.push("newest");

    expect(history.isBrowsing()).toBe(false);
    expect(history.previous("fresh draft")).toBe("newest");
  });
});
