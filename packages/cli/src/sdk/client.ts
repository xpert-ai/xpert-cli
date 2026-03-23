import { Client } from "@xpert-ai/xpert-sdk";
import type { ClientToolContextDescriptor, ResolvedXpertCliConfig } from "@xpert-cli/contracts";
import {
  renderLocalContextBlock,
  renderPromptWithLocalContext,
  type RunLocalContext,
} from "../context/run-context.js";
import { buildResumeInput, type ClientToolMessageInput } from "./tool-resume.js";
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

    const thread = await this.#client.threads.create({
      metadata: {
        source: "xpert-cli",
        cwd: this.#config.cwd,
        project_root: this.#config.projectRoot,
      },
    });

    return thread.thread_id;
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

    return { threadId, stream };
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

    return { threadId: request.threadId, stream };
  }

  async getCheckpoint(threadId: string): Promise<string | undefined> {
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

    return undefined;
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
  }): Promise<AsyncIterable<{ event?: string; data: unknown }>> {
    const response = await fetch(
      buildApiUrl(this.#config.apiUrl, `threads/${params.threadId}/runs/stream`),
      {
        method: "POST",
        headers: this.buildHeaders(),
        signal: params.signal,
        body: JSON.stringify({
          assistant_id: params.assistantId,
          input: params.input,
          context: params.context,
        }),
      },
    );

    if (!response.ok) {
      throw new Error(await readErrorResponse(response));
    }

    params.onRunCreated?.(getRunMetadataFromResponse(response));

    return iterateSseResponse(response, { signal: params.signal });
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

async function readErrorResponse(response: Response): Promise<string> {
  const body = await response.text();
  if (!body.trim()) {
    return `Run stream failed with HTTP ${response.status}`;
  }

  try {
    const parsed = JSON.parse(body) as {
      message?: string | string[];
      error?: string;
    };
    if (Array.isArray(parsed.message)) {
      return parsed.message.join("; ");
    }
    if (typeof parsed.message === "string") {
      return parsed.message;
    }
    if (typeof parsed.error === "string") {
      return parsed.error;
    }
  } catch {
    //
  }

  return body;
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
