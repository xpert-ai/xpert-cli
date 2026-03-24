import type { ResolvedXpertCliConfig } from "@xpert-cli/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RunLocalContext } from "../context/run-context.js";
import { XpertSdkClient } from "../sdk/client.js";
import { formatCliError, XpertCliRequestError } from "../sdk/request-errors.js";

describe("XpertSdkClient local context injection", () => {
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    fetchMock.mockReset();
    fetchMock.mockResolvedValue(
      new Response('event: complete\ndata: {"type":"complete"}\n\n', {
        status: 200,
        headers: {
          "Content-Location": "/threads/thread-1/runs/run-1",
          "content-type": "text/event-stream",
        },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("wraps the initial prompt and includes structured local context", async () => {
    const client = new XpertSdkClient(createConfig());

    await client.streamPrompt({
      prompt: "Summarize the repo status.",
      threadId: "thread-1",
      clientTools: [],
      localContext: createLocalContext(),
    });

    const body = parseRequestBody(fetchMock);

    expect(body.context.localContext.projectRoot).toBe("/tmp/project");
    expect(body.context.localCli.cwd).toBe("/tmp/project/packages/cli");
    expect(body.input.input.input).toContain("[Local Context]");
    expect(body.input.input.input).toContain("User request:\nSummarize the repo status.");
  });

  it("wraps the first resume tool message and preserves the rest", async () => {
    const client = new XpertSdkClient(createConfig());

    await client.resumeWithToolMessages({
      threadId: "thread-1",
      executionId: "run-1",
      clientTools: [],
      localContext: createLocalContext(),
      toolMessages: [
        {
          tool_call_id: "call-1",
          name: "Read",
          content: "1 | hello",
        },
        {
          tool_call_id: "call-2",
          name: "Glob",
          content: "src/index.ts",
        },
      ],
    });

    const body = parseRequestBody(fetchMock);
    const toolMessages = body.input.decision.payload.toolMessages as Array<{
      content: string;
      tool_call_id: string;
    }>;

    expect(body.context.localContext.git.statusShort).toBe("M packages/cli/src/sdk/client.ts");
    expect(toolMessages[0]?.content).toContain("[Local Context]");
    expect(toolMessages[0]?.content).toContain("Tool result:\n1 | hello");
    expect(toolMessages[1]?.content).toBe("src/index.ts");
  });

  it("normalizes connection failures for streamPrompt", async () => {
    const client = new XpertSdkClient(createConfig());
    fetchMock.mockRejectedValueOnce(
      withCause(
        new TypeError("fetch failed"),
        Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:3000"), {
          code: "ECONNREFUSED",
        }),
      ),
    );

    await expect(
      client.streamPrompt({
        prompt: "Ping the backend.",
        threadId: "thread-1",
        clientTools: [],
        localContext: createLocalContext(),
      }),
    ).rejects.toMatchObject({
      kind: "service_unavailable",
      message: "cannot reach xpert-pro at http://localhost:3000/api/ai",
    });
  });

  it("normalizes auth failures from non-2xx run-stream responses", async () => {
    const client = new XpertSdkClient(createConfig());
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ message: "Unauthorized" }), {
        status: 401,
        headers: {
          "content-type": "application/json",
        },
      }),
    );

    await expect(
      client.streamPrompt({
        prompt: "Ping the backend.",
        threadId: "thread-1",
        clientTools: [],
        localContext: createLocalContext(),
      }),
    ).rejects.toMatchObject({
      kind: "auth_failed",
    });
  });

  it("normalizes route mismatches from non-2xx run-stream responses", async () => {
    const client = new XpertSdkClient(createConfig());
    fetchMock.mockResolvedValueOnce(
      new Response("Cannot POST /api/ai/threads/thread-1/runs/stream", {
        status: 404,
        headers: {
          "content-type": "text/plain",
        },
      }),
    );

    await expect(
      client.streamPrompt({
        prompt: "Ping the backend.",
        threadId: "thread-1",
        clientTools: [],
        localContext: createLocalContext(),
      }),
    ).rejects.toMatchObject({
      kind: "protocol_error",
    });
  });

  it("normalizes assistant lookup failures with assistant-specific wording", async () => {
    const client = new XpertSdkClient(createConfig());
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ message: "The requested record was not found" }), {
        status: 404,
        headers: {
          "content-type": "application/json",
        },
      }),
    );

    await expect(client.getAssistant("assistant-missing")).rejects.toMatchObject({
      kind: "assistant_not_found",
      message: "assistant not found",
    });
  });

  it("distinguishes SSE connect failure from stream interruption", async () => {
    const client = new XpertSdkClient(createConfig());
    fetchMock
      .mockResolvedValueOnce(
        new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              controller.error(new Error("socket hang up"));
            },
          }),
          {
            status: 200,
            headers: {
              "content-type": "text/event-stream",
            },
          },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              const encoder = new TextEncoder();
              controller.enqueue(
                encoder.encode('event: message\ndata: {"type":"message","data":{"type":"text","text":"partial"}}\n\n'),
              );
              setTimeout(() => {
                controller.error(new Error("socket hang up"));
              }, 0);
            },
          }),
          {
            status: 200,
            headers: {
              "content-type": "text/event-stream",
            },
          },
        ),
      );

    const connect = await client.streamPrompt({
      prompt: "Ping the backend.",
      threadId: "thread-1",
      clientTools: [],
      localContext: createLocalContext(),
    });
    await expect(readAll(connect.stream)).rejects.toMatchObject({
      kind: "stream_connect_failed",
    });

    const interrupted = await client.streamPrompt({
      prompt: "Ping the backend again.",
      threadId: "thread-1",
      clientTools: [],
      localContext: createLocalContext(),
    });
    await expect(readAll(interrupted.stream)).rejects.toMatchObject({
      kind: "stream_interrupted",
    });
  });

  it("uses resume-specific wording when the resume stream breaks", async () => {
    const client = new XpertSdkClient(createConfig());
    fetchMock.mockResolvedValueOnce(
      new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            const encoder = new TextEncoder();
            controller.enqueue(
              encoder.encode('event: message\ndata: {"type":"message","data":{"type":"text","text":"partial"}}\n\n'),
            );
            setTimeout(() => {
              controller.error(new Error("socket hang up"));
            }, 0);
          },
        }),
        {
          status: 200,
          headers: {
            "content-type": "text/event-stream",
          },
        },
      ),
    );

    const response = await client.resumeWithToolMessages({
      threadId: "thread-1",
      executionId: "run-1",
      clientTools: [],
      localContext: createLocalContext(),
      toolMessages: [
        {
          tool_call_id: "call-1",
          name: "Read",
          content: "ok",
        },
      ],
    });

    await expect(readAll(response.stream)).rejects.toSatisfy((error: unknown) => {
      expect(error).toBeInstanceOf(XpertCliRequestError);
      expect((error as XpertCliRequestError).kind).toBe("resume_failed");
      expect(formatCliError(error)).toContain(
        "error: tool results could not be resumed to the current run",
      );
      return true;
    });
  });

  it("normalizes checkpoint failures from the shared sdk client", async () => {
    const client = new XpertSdkClient(createConfig());
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ message: "Forbidden" }), {
        status: 403,
        headers: {
          "content-type": "application/json",
        },
      }),
    );

    await expect(client.getCheckpoint("thread-1")).rejects.toMatchObject({
      kind: "auth_failed",
    });
  });
});

function parseRequestBody(fetchMock: ReturnType<typeof vi.fn>) {
  const init = fetchMock.mock.calls[0]?.[1];
  return JSON.parse(String(init?.body)) as Record<string, any>;
}

function createConfig(): ResolvedXpertCliConfig {
  return {
    apiUrl: "http://localhost:3000/api/ai",
    apiKey: "test-key",
    assistantId: "assistant-1",
    defaultModel: undefined,
    organizationId: undefined,
    approvalMode: "default",
    sandboxMode: "host",
    projectRoot: "/tmp/project",
    cwd: "/tmp/project/packages/cli",
    userConfigDir: "/tmp/.xpert-cli",
    userConfigPath: "/tmp/.xpert-cli/config.json",
    projectConfigPath: "/tmp/project/.xpert-cli.json",
    xpertMdPath: "/tmp/project/XPERT.md",
    xpertMdContent: "Stay inside xpert-cli.",
  };
}

function createLocalContext(): RunLocalContext {
  return {
    cwd: "/tmp/project/packages/cli",
    projectRoot: "/tmp/project",
    xpertMd: {
      available: true,
      path: "/tmp/project/XPERT.md",
      content: "Stay inside xpert-cli.",
      truncated: false,
    },
    git: {
      available: true,
      isRepo: true,
      statusShort: "M packages/cli/src/sdk/client.ts",
      truncated: false,
    },
    workingSet: {
      recentFiles: ["packages/cli/src/sdk/client.ts"],
      recentToolCalls: [
        {
          id: "call-1",
          toolName: "Read",
          summary: "read packages/cli/src/sdk/client.ts",
          status: "success",
          createdAt: "2026-03-21T00:00:00.000Z",
        },
      ],
    },
  };
}

async function readAll(stream: AsyncIterable<{ event?: string; data: unknown }>): Promise<void> {
  for await (const _chunk of stream) {
    //
  }
}

function withCause<T extends Error>(error: T, cause: unknown): T {
  Object.defineProperty(error, "cause", {
    configurable: true,
    enumerable: false,
    value: cause,
  });
  return error;
}
