import { describe, expect, it } from "vitest";
import {
  formatCliError,
  formatCliErrorBody,
  normalizeSdkRequestError,
  XpertCliRequestError,
} from "../sdk/request-errors.js";

describe("request error normalization", () => {
  it("maps fetch failed network errors to service_unavailable", () => {
    const error = withCause(
      new TypeError("fetch failed"),
      Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:3000"), {
        code: "ECONNREFUSED",
      }),
    );

    const normalized = normalizeSdkRequestError(error, {
      operation: "streamPrompt",
      apiUrl: "http://localhost:3000/api/ai",
      url: "http://localhost:3000/api/ai/threads/thread-1/runs/stream",
      method: "POST",
    });

    expect(normalized.kind).toBe("service_unavailable");
    expect(normalized.retryable).toBe(true);
    expect(formatCliError(normalized)).toContain(
      "error: cannot reach xpert-pro at http://localhost:3000/api/ai",
    );
    expect(formatCliError(normalized)).toContain("hint: start the backend or check XPERT_API_URL");
    expect(formatCliError(normalized)).not.toContain("error: fetch failed");
  });

  it("maps 401 and 403 responses to auth_failed", () => {
    const unauthorized = Object.assign(new Error('HTTP 401: {"message":"Unauthorized"}'), {
      status: 401,
      text: '{"message":"Unauthorized"}',
    });
    const forbidden = Object.assign(new Error("HTTP 403: Forbidden"), {
      status: 403,
      text: "Forbidden",
    });

    expect(
      normalizeSdkRequestError(unauthorized, {
        operation: "ensureThread",
        apiUrl: "http://localhost:3000/api/ai",
      }).kind,
    ).toBe("auth_failed");
    expect(
      normalizeSdkRequestError(forbidden, {
        operation: "getCheckpoint",
        apiUrl: "http://localhost:3000/api/ai",
      }).kind,
    ).toBe("auth_failed");
  });

  it("maps 404 and protocol mismatches to distinct kinds", () => {
    const routeMismatch = normalizeSdkRequestError(
      Object.assign(new Error("HTTP 404: Cannot POST /api/ai/threads"), {
        status: 404,
        text: "Cannot POST /api/ai/threads",
      }),
      {
        operation: "streamPrompt",
        apiUrl: "http://localhost:3000/api/ai",
      },
    );
    const protocol = normalizeSdkRequestError(
      new SyntaxError("Unexpected token < in JSON at position 0"),
      {
        operation: "getCheckpoint",
        apiUrl: "http://localhost:3000/api/ai",
      },
    );

    expect(routeMismatch.kind).toBe("protocol_error");
    expect(protocol.kind).toBe("protocol_error");
  });

  it("maps explicit thread-not-found errors to remote_thread_not_found", () => {
    const normalized = normalizeSdkRequestError(
      new Error("remote thread not found"),
      {
        operation: "streamPrompt",
        apiUrl: "http://localhost:3000/api/ai",
        url: "http://localhost:3000/api/ai/threads/thread-1/runs/stream",
        phase: "stream_event",
        preserveMessage: true,
      },
    );

    expect(normalized.kind).toBe("remote_thread_not_found");
    expect(normalized.message).toBe("remote thread not found");
  });

  it("does not infer remote_thread_not_found from a generic run-stream missing record", () => {
    const normalized = normalizeSdkRequestError(
      new Error("The requested record was not found"),
      {
        operation: "streamPrompt",
        apiUrl: "http://localhost:3000/api/ai",
        url: "http://localhost:3000/api/ai/threads/thread-1/runs/stream",
        phase: "stream_event",
        preserveMessage: true,
      },
    );

    expect(normalized.kind).toBe("request_failed");
    expect(normalized.message).toBe("The requested record was not found");
  });

  it("distinguishes SSE connect failures from stream interruptions", () => {
    const connectFailure = normalizeSdkRequestError(
      new Error("socket hang up"),
      {
        operation: "streamPrompt",
        apiUrl: "http://localhost:3000/api/ai",
        phase: "sse_connect",
      },
    );
    const interrupted = normalizeSdkRequestError(
      new Error("run stream ended before a complete event"),
      {
        operation: "streamPrompt",
        apiUrl: "http://localhost:3000/api/ai",
        phase: "stream",
      },
    );

    expect(connectFailure.kind).toBe("stream_connect_failed");
    expect(connectFailure.message).toContain("could not establish the run stream");
    expect(interrupted.kind).toBe("stream_interrupted");
    expect(interrupted.message).toContain("run stream was interrupted");
  });

  it("marks resume failures with resume-specific wording", () => {
    const normalized = normalizeSdkRequestError(
      new Error("stream ended before completion"),
      {
        operation: "resumeWithToolMessages",
        apiUrl: "http://localhost:3000/api/ai",
        phase: "stream",
      },
    );

    expect(normalized.kind).toBe("resume_failed");
    expect(normalized.message).toBe("tool results could not be resumed to the current run");
    expect(formatCliError(normalized)).toContain(
      "hint: check XPERT_API_KEY, XPERT_AGENT_ID, and XPERT_API_URL",
    );
  });

  it("preserves explicit stream-event messages instead of rewriting them as interruptions", () => {
    const normalized = normalizeSdkRequestError(new Error("assistant not found"), {
      operation: "streamPrompt",
      apiUrl: "http://localhost:3000/api/ai",
      url: "http://localhost:3000/api/ai/threads/thread-1/runs/stream",
      method: "POST",
      phase: "stream_event",
      preserveMessage: true,
    });

    expect(normalized.kind).toBe("assistant_not_found");
    expect(normalized.message).toBe("assistant not found");
    expect(formatCliError(normalized)).not.toContain("run stream was interrupted");
  });

  it("maps assistant lookup 404s to assistant_not_found", () => {
    const normalized = normalizeSdkRequestError(
      Object.assign(new Error("HTTP 404: The requested record was not found"), {
        status: 404,
        text: '{"message":"The requested record was not found"}',
      }),
      {
        operation: "getAssistant",
        apiUrl: "http://localhost:3000/api/ai",
        url: "http://localhost:3000/api/ai/assistants/assistant-1",
        method: "GET",
      },
    );

    expect(normalized.kind).toBe("assistant_not_found");
    expect(formatCliError(normalized)).toContain("error: assistant not found");
    expect(formatCliError(normalized)).toContain("hint: check XPERT_AGENT_ID");
  });

  it("does not misreport remote thread failures as assistant_not_found", () => {
    const normalized = normalizeSdkRequestError(new Error("The requested record was not found"), {
      operation: "getCheckpoint",
      apiUrl: "http://localhost:3000/api/ai",
      url: "http://localhost:3000/api/ai/threads/thread-1/state",
      method: "GET",
      preserveMessage: true,
    });

    expect(normalized.kind).toBe("remote_thread_not_found");
    expect(normalized.message).toBe("remote thread not found");
  });

  it("formats invalid API URL errors with explicit config guidance", () => {
    const normalized = normalizeSdkRequestError(new TypeError("Invalid URL"), {
      operation: "streamPrompt",
      apiUrl: "http://localhost:3000 api/ai",
      method: "POST",
    });

    expect(normalized).toBeInstanceOf(XpertCliRequestError);
    expect(normalized.message).toBe("invalid XPERT_API_URL: http://localhost:3000 api/ai");
    expect(formatCliError(normalized)).toContain("detail: XPERT_API_URL=http://localhost:3000 api/ai");
  });

  it("can render request errors without a duplicated error prefix for Ink history", () => {
    const normalized = normalizeSdkRequestError(new Error("remote thread not found"), {
      operation: "streamPrompt",
      apiUrl: "http://localhost:3000/api/ai",
      url: "http://localhost:3000/api/ai/threads/thread-1/runs/stream",
      phase: "stream_event",
      preserveMessage: true,
    });

    expect(formatCliError(normalized)).toContain("error: remote thread not found");
    expect(formatCliErrorBody(normalized)).toContain("remote thread not found");
    expect(formatCliErrorBody(normalized)).not.toContain("error: remote thread not found");
  });
});

function withCause<T extends Error>(error: T, cause: unknown): T {
  Object.defineProperty(error, "cause", {
    configurable: true,
    enumerable: false,
    value: cause,
  });
  return error;
}
