import type { ResolvedXpertCliConfig } from "@xpert-cli/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RunLocalContext } from "../context/run-context.js";
import { XpertSdkClient } from "../sdk/client.js";

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
