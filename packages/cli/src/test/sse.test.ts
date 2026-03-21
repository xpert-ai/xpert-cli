import { describe, expect, it } from "vitest";
import { BytesLineDecoder, SSEDecoder } from "../sdk/sse.js";

describe("SSEDecoder", () => {
  it("falls back to plain text when event data is not JSON", async () => {
    const encoder = new TextEncoder();
    const source = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode("event: error\n"));
        controller.enqueue(encoder.encode("data: message: Required\n\n"));
        controller.close();
      },
    });

    const stream = source.pipeThrough(BytesLineDecoder()).pipeThrough(SSEDecoder());
    const reader = stream.getReader();
    const chunks = [];

    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      chunks.push(value);
    }

    expect(chunks).toEqual([
      {
        event: "error",
        id: undefined,
        data: "message: Required",
      },
    ]);
  });
});
