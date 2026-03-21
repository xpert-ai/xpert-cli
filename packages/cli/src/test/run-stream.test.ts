import { describe, expect, it } from "vitest";
import { adaptRunStream } from "../sdk/run-stream.js";

describe("adaptRunStream", () => {
  it("extracts tool calls from interrupt payloads", async () => {
    async function* fakeStream() {
      yield {
        event: "message",
        data: {
          type: "event",
          event: "on_message_start",
          data: {
            executionId: "run-123",
          },
        },
      };
      yield {
        event: "message",
        data: {
          type: "event",
          event: "on_interrupt",
          data: {
            tasks: [
              {
                interrupts: [
                  {
                    value: {
                      clientToolCalls: [
                        {
                          id: "call-1",
                          name: "Read",
                          args: { path: "src/demo.ts" },
                        },
                      ],
                    },
                  },
                ],
              },
            ],
          },
        },
      };
      yield {
        event: "complete",
        data: { type: "complete" },
      };
    }

    const events = [];
    for await (const event of adaptRunStream(fakeStream(), {})) {
      events.push(event);
    }

    expect(events).toEqual([
      {
        type: "tool_call",
        toolName: "Read",
        callId: "call-1",
        interruptId: undefined,
        args: { path: "src/demo.ts" },
        runId: "run-123",
      },
      {
        type: "done",
        runId: "run-123",
        threadId: undefined,
      },
    ]);
  });

  it("extracts assistant text deltas from message payloads", async () => {
    async function* fakeStream() {
      yield {
        event: "message",
        data: {
          type: "message",
          data: {
            type: "text",
            text: "Hello",
          },
        },
      };
      yield {
        event: "message",
        data: {
          type: "message",
          data: {
            type: "text",
            text: " world",
          },
        },
      };
      yield {
        event: "complete",
        data: { type: "complete" },
      };
    }

    const events = [];
    for await (const event of adaptRunStream(fakeStream(), {})) {
      events.push(event);
    }

    expect(events).toEqual([
      { type: "text_delta", text: "Hello" },
      { type: "text_delta", text: " world" },
      {
        type: "done",
        runId: undefined,
        threadId: undefined,
      },
    ]);
  });

  it("maps SSE error events with plain text payloads", async () => {
    async function* fakeStream() {
      yield {
        event: "error",
        data: "message: Required",
      };
    }

    const events = [];
    for await (const event of adaptRunStream(fakeStream(), {})) {
      events.push(event);
    }

    expect(events).toEqual([
      {
        type: "error",
        message: "message: Required",
      },
    ]);
  });
});
