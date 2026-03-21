import { describe, expect, it } from "vitest";
import { buildResumeInput } from "../sdk/tool-resume.js";

describe("buildResumeInput", () => {
  it("builds a flat toolMessages payload when interrupt ids are present", () => {
    expect(
      buildResumeInput({
        executionId: "execution-1",
        toolMessages: [
          {
            tool_call_id: "call-1",
            name: "Bash",
            content: "ok",
            interruptId: "interrupt-1",
          },
        ],
      }),
    ).toEqual({
      action: "resume",
      target: {
        executionId: "execution-1",
      },
      decision: {
        type: "confirm",
        payload: {
          toolMessages: [
            {
              tool_call_id: "call-1",
              name: "Bash",
              content: "ok",
            },
          ],
        },
      },
    });
  });

  it("builds the same flat payload when interrupt ids are missing", () => {
    expect(
      buildResumeInput({
        executionId: "execution-1",
        toolMessages: [
          {
            tool_call_id: "call-1",
            name: "Bash",
            content: "ok",
          },
        ],
      }),
    ).toEqual({
      action: "resume",
      target: {
        executionId: "execution-1",
      },
      decision: {
        type: "confirm",
        payload: {
          toolMessages: [
            {
              tool_call_id: "call-1",
              name: "Bash",
              content: "ok",
            },
          ],
        },
      },
    });
  });
});
