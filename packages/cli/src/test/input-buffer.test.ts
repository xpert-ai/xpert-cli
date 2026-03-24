import { describe, expect, it, vi } from "vitest";
import {
  createInputBufferController,
  parseInputChunk,
} from "../ui/input-buffer.js";

describe("createInputBufferController", () => {
  it("submits the latest appended text even before React state flushes", () => {
    const onChange = vi.fn();
    const buffer = createInputBufferController(onChange);

    buffer.append("run ");
    buffer.append("pwd with bash");

    expect(buffer.getValue()).toBe("run pwd with bash");
    expect(buffer.takeTrimmedValue()).toBe("run pwd with bash");
    expect(buffer.getValue()).toBe("");
    expect(onChange).toHaveBeenLastCalledWith("");
  });

  it("clears the buffer before handing the prompt to async submit logic", async () => {
    const buffer = createInputBufferController(() => {});
    buffer.append("  /status  ");

    const prompt = buffer.takeTrimmedValue();

    await Promise.resolve();

    expect(prompt).toBe("/status");
    expect(buffer.getValue()).toBe("");
  });

  it("replaces the current buffer value in one update for history navigation", () => {
    const onChange = vi.fn();
    const buffer = createInputBufferController(onChange);

    buffer.append("draft");
    buffer.setValue("previous prompt");

    expect(buffer.getValue()).toBe("previous prompt");
    expect(onChange).toHaveBeenLastCalledWith("previous prompt");
  });

  it("treats pasted chunks that end with carriage return as a submit", () => {
    expect(parseInputChunk("/status\r")).toEqual({
      text: "/status",
      submit: true,
    });
  });

  it("treats linefeed-only chunks as a submit without extra text", () => {
    expect(parseInputChunk("\n")).toEqual({
      text: "",
      submit: true,
    });
  });
});
