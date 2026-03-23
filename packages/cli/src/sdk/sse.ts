import { createAbortError } from "../runtime/turn-control.js";

const CR = "\r".charCodeAt(0);
const LF = "\n".charCodeAt(0);
const NULL = "\0".charCodeAt(0);
const COLON = ":".charCodeAt(0);
const SPACE = " ".charCodeAt(0);
const TRAILING_NEWLINE = [CR, LF];

export interface SseChunk {
  id?: string;
  event?: string;
  data: unknown;
}

export function BytesLineDecoder() {
  let buffer: Uint8Array[] = [];
  let trailingCr = false;

  return new TransformStream<Uint8Array, Uint8Array>({
    start() {
      buffer = [];
      trailingCr = false;
    },

    transform(chunk, controller) {
      let text = chunk;

      if (trailingCr) {
        text = joinArrays([[CR], text]);
        trailingCr = false;
      }

      if (text.length > 0 && text.at(-1) === CR) {
        trailingCr = true;
        text = text.subarray(0, -1);
      }

      if (!text.length) {
        return;
      }

      const trailingNewline = TRAILING_NEWLINE.includes(text.at(-1)!);
      const lastIdx = text.length - 1;
      const { lines } = text.reduce<{ lines: Uint8Array[]; from: number }>(
        (acc, cur, idx) => {
          if (acc.from > idx) {
            return acc;
          }

          if (cur === CR || cur === LF) {
            acc.lines.push(text.subarray(acc.from, idx));
            if (cur === CR && text[idx + 1] === LF) {
              acc.from = idx + 2;
            } else {
              acc.from = idx + 1;
            }
          }

          if (idx === lastIdx && acc.from <= lastIdx) {
            acc.lines.push(text.subarray(acc.from));
          }

          return acc;
        },
        { lines: [], from: 0 },
      );

      if (lines.length === 1 && !trailingNewline) {
        buffer.push(lines[0]!);
        return;
      }

      if (buffer.length) {
        buffer.push(lines[0]!);
        lines[0] = joinArrays(buffer);
        buffer = [];
      }

      if (!trailingNewline && lines.length) {
        buffer = [lines.pop()!];
      }

      for (const line of lines) {
        controller.enqueue(line);
      }
    },

    flush(controller) {
      if (buffer.length) {
        controller.enqueue(joinArrays(buffer));
      }
    },
  });
}

export function SSEDecoder() {
  let event = "";
  let data: Uint8Array[] = [];
  let lastEventId = "";
  let retry: number | null = null;

  const decoder = new TextDecoder();

  return new TransformStream<Uint8Array, SseChunk>({
    transform(chunk, controller) {
      if (!chunk.length) {
        if (!event && !data.length && !lastEventId && retry == null) {
          return;
        }

        controller.enqueue({
          id: lastEventId || undefined,
          event: event || undefined,
          data: data.length ? decodeArrays(decoder, data) : null,
        });

        event = "";
        data = [];
        retry = null;
        return;
      }

      if (chunk[0] === COLON) {
        return;
      }

      const sepIdx = chunk.indexOf(COLON);
      if (sepIdx === -1) {
        return;
      }

      const fieldName = decoder.decode(chunk.subarray(0, sepIdx));
      let value = chunk.subarray(sepIdx + 1);
      if (value[0] === SPACE) {
        value = value.subarray(1);
      }

      if (fieldName === "event") {
        event = decoder.decode(value);
      } else if (fieldName === "data") {
        data.push(value);
      } else if (fieldName === "id") {
        if (value.indexOf(NULL) === -1) {
          lastEventId = decoder.decode(value);
        }
      } else if (fieldName === "retry") {
        const retryNum = Number.parseInt(decoder.decode(value), 10);
        if (!Number.isNaN(retryNum)) {
          retry = retryNum;
        }
      }
    },

    flush(controller) {
      if (!event && !data.length) {
        return;
      }

      controller.enqueue({
        id: lastEventId || undefined,
        event: event || undefined,
        data: data.length ? decodeArrays(decoder, data) : null,
      });
    },
  });
}

export async function* iterateSseResponse(
  response: Response,
  options?: { signal?: AbortSignal },
): AsyncGenerator<SseChunk> {
  const body = response.body;
  if (!body) {
    return;
  }

  const stream = body.pipeThrough(BytesLineDecoder()).pipeThrough(SSEDecoder());
  const reader = stream.getReader();
  const signal = options?.signal;
  const abortReader = () => {
    void reader.cancel(getAbortReason(signal));
  };

  if (signal?.aborted) {
    throw getAbortReason(signal);
  }

  signal?.addEventListener("abort", abortReader, { once: true });

  try {
    while (true) {
      throwIfAborted(signal);
      const { done, value } = await reader.read();
      throwIfAborted(signal);
      if (done) {
        break;
      }

      if (value) {
        yield value;
      }
    }
  } finally {
    signal?.removeEventListener("abort", abortReader);
    reader.releaseLock();
  }
}

function joinArrays(data: ArrayLike<number>[]) {
  const totalLength = data.reduce((acc, curr) => acc + curr.length, 0);
  const merged = new Uint8Array(totalLength);
  let offset = 0;
  for (const item of data) {
    merged.set(item, offset);
    offset += item.length;
  }
  return merged;
}

function decodeArrays(decoder: InstanceType<typeof TextDecoder>, data: ArrayLike<number>[]) {
  const text = decoder.decode(joinArrays(data));

  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw getAbortReason(signal);
  }
}

function getAbortReason(signal?: AbortSignal): Error {
  return signal?.reason instanceof Error ? signal.reason : createAbortError();
}
