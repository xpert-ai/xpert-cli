import { Client } from "@xpert-ai/xpert-sdk";
import type { ClientToolContextDescriptor, ResolvedXpertCliConfig } from "@xpert-cli/contracts";
import {
  renderLocalContextBlock,
  renderPromptWithLocalContext,
  type RunLocalContext,
} from "../context/run-context.js";
import { buildResumeInput, type ClientToolMessageInput } from "./tool-resume.js";
import {
  isAbortLikeError,
  normalizeSdkRequestError,
} from "./request-errors.js";
import { iterateSseResponse } from "./sse.js";

export interface StreamRunRequest {
  prompt: string;
  threadId?: string;
  clientTools: ClientToolContextDescriptor[];
  localContext: RunLocalContext;
  signal?: AbortSignal;
  onRunCreated?: (params: { runId?: string; threadId?: string }) => void;
}

export interface ResumeRunRequest {
  threadId: string;
  executionId: string;
  clientTools: ClientToolContextDescriptor[];
  localContext: RunLocalContext;
  toolMessages: ClientToolMessageInput[];
  signal?: AbortSignal;
  onRunCreated?: (params: { runId?: string; threadId?: string }) => void;
}

export interface RunStreamResponse {
  threadId: string;
  stream: AsyncIterable<{ event?: string; data: unknown }>;
  requestUrl?: string;
}

export class XpertSdkClient {
  readonly #config: ResolvedXpertCliConfig;
  readonly #client: Client;

  constructor(config: ResolvedXpertCliConfig) {
    this.#config = config;
    this.#client = new Client({
      apiUrl: config.apiUrl,
      apiKey: config.apiKey,
      defaultHeaders: config.organizationId
        ? {
            "organization-id": config.organizationId,
          }
        : undefined,
    });
  }

  async ensureThread(existingThreadId?: string): Promise<string> {
    if (existingThreadId) {
      return existingThreadId;
    }

    let requestUrl: string | undefined;
    try {
      requestUrl = buildApiUrl(this.#config.apiUrl, "threads").toString();
    } catch (error) {
      throw normalizeSdkRequestError(error, {
        operation: "ensureThread",
        apiUrl: this.#config.apiUrl,
        method: "POST",
      });
    }

    try {
      const thread = await this.#client.threads.create({
        metadata: {
          source: "xpert-cli",
          cwd: this.#config.cwd,
          project_root: this.#config.projectRoot,
        },
      });

      return thread.thread_id;
    } catch (error) {
      if (isAbortLikeError(error)) {
        throw error;
      }
      throw normalizeSdkRequestError(error, {
        operation: "ensureThread",
        apiUrl: this.#config.apiUrl,
        url: requestUrl,
        method: "POST",
      });
    }
  }

  async streamPrompt(request: StreamRunRequest): Promise<RunStreamResponse> {
    const assistantId = this.requireAssistantId();
    const threadId = await this.ensureThread(request.threadId);
    const stream = await this.streamRun({
      threadId,
      assistantId,
      input: {
        input: {
          input: renderPromptWithLocalContext(request.prompt, request.localContext),
        },
      },
      context: {
        clientTools: request.clientTools,
        client_tool_mode: "local-cli",
        localCli: {
          projectRoot: request.localContext.projectRoot,
          cwd: request.localContext.cwd,
          sandboxMode: this.#config.sandboxMode,
        },
        localContext: request.localContext,
      },
      signal: request.signal,
      onRunCreated: request.onRunCreated,
    });

    return { threadId, stream, requestUrl: stream.requestUrl };
  }

  async resumeWithToolMessages(
    request: ResumeRunRequest,
  ): Promise<RunStreamResponse> {
    const assistantId = this.requireAssistantId();
    const localContextBlock = renderLocalContextBlock(request.localContext);
    const stream = await this.streamRun({
      threadId: request.threadId,
      assistantId,
      input: buildResumeInput({
        executionId: request.executionId,
        toolMessages: injectLocalContextIntoToolMessages(
          request.toolMessages,
          localContextBlock,
        ),
      }),
      context: {
        clientTools: request.clientTools,
        client_tool_mode: "local-cli",
        localCli: {
          projectRoot: request.localContext.projectRoot,
          cwd: request.localContext.cwd,
          sandboxMode: this.#config.sandboxMode,
        },
        localContext: request.localContext,
      },
      signal: request.signal,
      onRunCreated: request.onRunCreated,
    });

    return { threadId: request.threadId, stream, requestUrl: stream.requestUrl };
  }

  async getCheckpoint(threadId: string): Promise<string | undefined> {
    let requestUrl: string | undefined;
    try {
      requestUrl = buildApiUrl(this.#config.apiUrl, `threads/${threadId}/state`).toString();
    } catch (error) {
      throw normalizeSdkRequestError(error, {
        operation: "getCheckpoint",
        apiUrl: this.#config.apiUrl,
        method: "GET",
      });
    }

    try {
      const state = await this.#client.threads.getState(threadId);
      const checkpoint = state.checkpoint as Record<string, unknown> | undefined;
      const configurable =
        (checkpoint?.configurable as Record<string, unknown> | undefined) ??
        checkpoint;

      if (
        configurable &&
        typeof configurable === "object" &&
        "checkpoint_id" in configurable &&
        typeof configurable.checkpoint_id === "string"
      ) {
        return configurable.checkpoint_id;
      }
    } catch (error) {
      if (isAbortLikeError(error)) {
        throw error;
      }
      throw normalizeSdkRequestError(error, {
        operation: "getCheckpoint",
        apiUrl: this.#config.apiUrl,
        url: requestUrl,
        method: "GET",
      });
    }

    return undefined;
  }

  async getAssistant(assistantId = this.requireAssistantId()): Promise<unknown> {
    let requestUrl: string | undefined;
    try {
      requestUrl = buildApiUrl(this.#config.apiUrl, `assistants/${assistantId}`).toString();
    } catch (error) {
      throw normalizeSdkRequestError(error, {
        operation: "getAssistant",
        apiUrl: this.#config.apiUrl,
        method: "GET",
      });
    }

    try {
      return await this.#client.assistants.get(assistantId);
    } catch (error) {
      if (isAbortLikeError(error)) {
        throw error;
      }
      throw normalizeSdkRequestError(error, {
        operation: "getAssistant",
        apiUrl: this.#config.apiUrl,
        url: requestUrl,
        method: "GET",
      });
    }
  }

  private requireAssistantId(): string {
    if (!this.#config.assistantId) {
      throw new Error("Missing XPERT_AGENT_ID / assistantId configuration");
    }
    return this.#config.assistantId;
  }

  private async streamRun(params: {
    threadId: string;
    assistantId: string;
    input: Record<string, unknown>;
    context: Record<string, unknown>;
    signal?: AbortSignal;
    onRunCreated?: (params: { runId?: string; threadId?: string }) => void;
  }): Promise<AsyncIterable<{ event?: string; data: unknown }> & { requestUrl?: string }> {
    const operation = isResumeInput(params.input)
      ? "resumeWithToolMessages"
      : "streamPrompt";
    let requestUrl: string | undefined;
    try {
      requestUrl = buildApiUrl(
        this.#config.apiUrl,
        `threads/${params.threadId}/runs/stream`,
      ).toString();
    } catch (error) {
      throw normalizeSdkRequestError(error, {
        operation,
        apiUrl: this.#config.apiUrl,
        method: "POST",
      });
    }
    const resolvedRequestUrl = requestUrl;

    let response: Response;
    try {
      response = await fetch(resolvedRequestUrl, {
        method: "POST",
        headers: this.buildHeaders(),
        signal: params.signal,
        body: JSON.stringify({
          assistant_id: params.assistantId,
          input: params.input,
          context: params.context,
        }),
      });
    } catch (error) {
      if (isAbortLikeError(error)) {
        throw error;
      }
      throw normalizeSdkRequestError(error, {
        operation,
        apiUrl: this.#config.apiUrl,
        url: resolvedRequestUrl,
        method: "POST",
      });
    }

    if (!response.ok) {
      throw normalizeSdkRequestError(new Error(`HTTP ${response.status}`), {
        operation,
        apiUrl: this.#config.apiUrl,
        url: resolvedRequestUrl,
        method: "POST",
        statusCode: response.status,
        responseBody: await readResponseBody(response),
      });
    }

    const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
    if (!contentType.includes("text/event-stream")) {
      throw normalizeSdkRequestError(
        new Error(`Expected text/event-stream response but received ${contentType || "unknown content-type"}`),
        {
          operation,
          apiUrl: this.#config.apiUrl,
          url: resolvedRequestUrl,
          method: "POST",
          phase: "sse_connect",
          responseBody: await readResponseBody(response),
        },
      );
    }

    params.onRunCreated?.(getRunMetadataFromResponse(response));

    return wrapStreamRequest(
      iterateSseResponse(response, { signal: params.signal }),
      {
        operation,
        apiUrl: this.#config.apiUrl,
        requestUrl: resolvedRequestUrl,
      },
    );
  }

  private buildHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      "content-type": "application/json",
    };

    if (this.#config.apiKey) {
      headers["x-api-key"] = this.#config.apiKey;
    }

    if (this.#config.organizationId) {
      headers["organization-id"] = this.#config.organizationId;
    }

    return headers;
  }
}

const REGEX_RUN_METADATA = /(\/threads\/(?<thread_id>.+))?\/runs\/(?<run_id>.+)/;

function getRunMetadataFromResponse(response: Response): {
  runId?: string;
  threadId?: string;
} {
  const contentLocation = response.headers.get("Content-Location");
  if (!contentLocation) {
    return {};
  }

  const match = REGEX_RUN_METADATA.exec(contentLocation);
  if (!match?.groups?.run_id) {
    return {};
  }

  return {
    runId: match.groups.run_id,
    threadId: match.groups.thread_id || undefined,
  };
}

async function readResponseBody(response: Response): Promise<string | undefined> {
  const body = await response.text();
  return body.trim() ? body : undefined;
}

function buildApiUrl(apiUrl: string, path: string): URL {
  const normalizedBase = apiUrl.endsWith("/") ? apiUrl : `${apiUrl}/`;
  const normalizedPath = path.replace(/^\/+/, "");
  return new URL(normalizedPath, normalizedBase);
}

function injectLocalContextIntoToolMessages(
  toolMessages: ClientToolMessageInput[],
  localContextBlock: string,
): ClientToolMessageInput[] {
  const firstMessage = toolMessages[0];
  if (!firstMessage) {
    return toolMessages;
  }

  const rest = toolMessages.slice(1);
  return [
    {
      ...firstMessage,
      content: `${localContextBlock}\n\nTool result:\n${stringifyToolMessageContent(firstMessage.content)}`,
    },
    ...rest,
  ];
}

function stringifyToolMessageContent(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }
  if (content == null) {
    return "";
  }

  try {
    return JSON.stringify(content);
  } catch {
    return String(content);
  }
}

function isResumeInput(input: Record<string, unknown>): boolean {
  return "decision" in input;
}

function wrapStreamRequest(
  stream: AsyncIterable<{ event?: string; data: unknown }>,
  input: {
    operation: "streamPrompt" | "resumeWithToolMessages";
    apiUrl: string;
    requestUrl: string;
  },
): AsyncIterable<{ event?: string; data: unknown }> & { requestUrl?: string } {
  return {
    requestUrl: input.requestUrl,
    async *[Symbol.asyncIterator]() {
      let sawChunk = false;

      try {
        for await (const chunk of stream) {
          sawChunk = true;
          yield chunk;
        }
      } catch (error) {
        if (isAbortLikeError(error)) {
          throw error;
        }
        throw normalizeSdkRequestError(error, {
          operation: input.operation,
          apiUrl: input.apiUrl,
          url: input.requestUrl,
          method: "POST",
          phase: sawChunk ? "stream" : "sse_connect",
        });
      }
    },
  };
}
