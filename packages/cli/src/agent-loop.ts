import type { ResolvedXpertCliConfig } from "@xpert-cli/contracts";
import { PermissionManager } from "./permissions/manager.js";
import { buildRunLocalContext } from "./context/run-context.js";
import { ToolCallGuard } from "./runtime/tool-call-guard.js";
import {
  summarizeToolArgs,
  TurnTranscriptRecorder,
} from "./runtime/turn-transcript.js";
import {
  createRenderTranscriptConsumer,
  createSessionRuntimeConsumer,
  createTurnEventDispatcher,
  createTurnTranscriptConsumer,
  createUiTurnEventConsumer,
  createWorkingSetConsumer,
} from "./runtime/turn-event-consumers.js";
import type { TurnEventInput } from "./runtime/turn-events.js";
import {
  ToolCallBudget,
  toToolBudgetExceededResult,
} from "./runtime/tool-budget.js";
import {
  toInvalidToolPayloadResult,
  validateToolPayload,
} from "./runtime/tool-validation.js";
import { isAbortError, throwIfAborted } from "./runtime/turn-control.js";
import type { CliSessionState } from "./runtime/session-store.js";
import { buildToolMessage, type ClientToolMessageInput } from "./sdk/tool-resume.js";
import { adaptRunStream } from "./sdk/run-stream.js";
import { XpertSdkClient } from "./sdk/client.js";
import {
  formatCliError,
  isXpertCliRequestError,
  normalizeSdkRequestError,
  type XpertCliRequestError,
} from "./sdk/request-errors.js";
import { createToolRegistry } from "./tools/registry.js";
import { HostExecutionBackend } from "./tools/backends/host.js";
import type {
  ExecutionBackend,
  ToolExecutionContext,
  ToolExecutionResult,
  ToolRegistry,
} from "./tools/contracts.js";
import type { UiSink } from "./ui/sink.js";
import { TextUiRenderer } from "./ui/text-renderer.js";
import type { PermissionPromptHandler } from "./ui/permission.js";

export async function runAgentTurn(options: {
  prompt: string;
  config: ResolvedXpertCliConfig;
  session: CliSessionState;
  interactive: boolean;
  signal?: AbortSignal;
  ui?: UiSink;
  toolRegistry?: ToolRegistry;
  promptForPermission?: PermissionPromptHandler;
}): Promise<CliSessionState> {
  const ui = options.ui ?? new TextUiRenderer({ interactive: options.interactive });
  const backend = new HostExecutionBackend(options.session.projectRoot);
  const permissions = new PermissionManager({
    session: options.session,
    approvalMode: options.config.approvalMode,
    interactive: ui.interactive,
    promptForPermission: options.promptForPermission,
  });
  const sdk = new XpertSdkClient(options.config);
  const registry = options.toolRegistry ?? createToolRegistry();
  const toolCallGuard = new ToolCallGuard();
  const toolBudget = new ToolCallBudget();
  const transcript = new TurnTranscriptRecorder({
    prompt: options.prompt,
    threadId: options.session.threadId,
    runId: options.session.runId,
    checkpointId: options.session.checkpointId,
  });
  let finalized = false;
  const emitTurnEvent = createTurnEventDispatcher([
    createSessionRuntimeConsumer(options.session),
    createWorkingSetConsumer(options.session),
    createRenderTranscriptConsumer({
      prompt: options.prompt,
      recorder: transcript,
      includeReasoning: isTruthy(process.env.XPERT_CLI_SHOW_REASONING),
    }),
    createTurnTranscriptConsumer({
      session: options.session,
      recorder: transcript,
    }),
    createUiTurnEventConsumer(ui),
  ]);

  const finishTurn = (input: {
    status: "completed" | "cancelled" | "failed";
    error?: string;
    cancelled?: boolean;
  }): void => {
    if (finalized) {
      return;
    }

    emitTurnEvent({
      type: "turn_finished",
      status: input.status,
      threadId: options.session.threadId,
      runId: options.session.runId,
      checkpointId: options.session.checkpointId,
      error: input.error,
      cancelled: input.cancelled,
    });
    finalized = true;
  };

  try {
    options.session.threadId = await sdk.ensureThread(options.session.threadId);
    emitTurnEvent({
      type: "turn_started",
      prompt: options.prompt,
      threadId: options.session.threadId,
      runId: options.session.runId,
      checkpointId: options.session.checkpointId,
    });

    let pendingToolMessages: ClientToolMessageInput[] | null = null;
    let executionId = options.session.runId;
    let retriedMissingThread = false;

    turnLoop: while (true) {
      throwIfAborted(options.signal);
      const requestOperation = pendingToolMessages
        ? "resumeWithToolMessages"
        : "streamPrompt";

      const state: { threadId?: string; runId?: string } = {
        threadId: options.session.threadId,
        runId: executionId,
      };
      const localContext = await buildRunLocalContext({
        config: options.config,
        session: options.session,
        signal: options.signal,
      });

      const request = pendingToolMessages
        ? await sdk.resumeWithToolMessages({
            threadId: options.session.threadId ?? failMissingThreadId(),
            executionId: executionId ?? failMissingExecutionId(),
            clientTools: registry.clientTools,
            localContext,
            toolMessages: pendingToolMessages,
            signal: options.signal,
            onRunCreated: ({ runId, threadId }) => {
              if (runId) {
                executionId = runId;
                options.session.runId = runId;
              }
              if (threadId) {
                options.session.threadId = threadId;
              }
            },
          })
        : await sdk.streamPrompt({
            prompt: options.prompt,
            threadId: options.session.threadId,
            clientTools: registry.clientTools,
            localContext,
            signal: options.signal,
            onRunCreated: ({ runId, threadId }) => {
              if (runId) {
                executionId = runId;
                options.session.runId = runId;
              }
              if (threadId) {
                options.session.threadId = threadId;
              }
            },
          });

      const toolMessages: ClientToolMessageInput[] = [];
      let sawDone = false;
      let retryWithFreshThread = false;

      for await (const event of adaptRunStream(request.stream, state)) {
        throwIfAborted(options.signal);

        if (event.type === "text_delta") {
          emitTurnEvent({
            type: "assistant_text_delta",
            text: event.text,
          });
          continue;
        }

        if (event.type === "reasoning") {
          emitTurnEvent({
            type: "reasoning",
            text: event.text,
          });
          continue;
        }

        if (event.type === "tool_call") {
          const tool = registry.tools.get(event.toolName);
          const args = event.args;
          const argsSummary = summarizeToolArgs(event.toolName, args);

          const guardDecision = toolCallGuard.begin({
            callId: event.callId,
            toolName: event.toolName,
            args,
          });
          if (guardDecision.kind === "already_handled") {
            continue;
          }

          emitTurnEvent({
            type: "tool_requested",
            callId: event.callId,
            toolName: event.toolName,
            argsSummary,
            target: stringifyTarget(args),
            interruptId: event.interruptId,
          });

          if (guardDecision.kind === "blocked") {
            const result = toToolErrorResult({
              code: "REPEATED_TOOL_CALL_BLOCKED",
              message: `${guardDecision.reason}. Use the previous result instead.`,
            });
            const message = buildToolMessage({
              callId: event.callId,
              toolName: event.toolName,
              result,
              status: "error",
              interruptId: event.interruptId,
            });
            toolCallGuard.remember(event.callId, message);
            toolMessages.push(message);
            emitTurnEvent({
              type: "warning",
              message: result.summary,
              callId: event.callId,
              toolName: event.toolName,
              code: "REPEATED_TOOL_CALL_BLOCKED",
            });
            emitTurnEvent({
              type: "tool_completed",
              callId: event.callId,
              toolName: event.toolName,
              argsSummary,
              summary: result.summary,
              status: "error",
              code: "REPEATED_TOOL_CALL_BLOCKED",
            });
            continue;
          }

          const budgetDecision = toolBudget.consume();
          if (budgetDecision.kind === "exceeded") {
            const result = toToolBudgetExceededResult(budgetDecision);
            const message = buildToolMessage({
              callId: event.callId,
              toolName: event.toolName,
              result,
              status: "error",
              interruptId: event.interruptId,
            });
            toolCallGuard.remember(event.callId, message);
            toolMessages.push(message);
            emitTurnEvent({
              type: "warning",
              message: result.summary,
              callId: event.callId,
              toolName: event.toolName,
              code: "TOOL_CALL_BUDGET_EXCEEDED",
            });
            emitTurnEvent({
              type: "tool_completed",
              callId: event.callId,
              toolName: event.toolName,
              argsSummary,
              summary: result.summary,
              status: "error",
              code: "TOOL_CALL_BUDGET_EXCEEDED",
            });
            continue;
          }

          if (!tool) {
            const result = toToolErrorResult({
              code: "UNKNOWN_TOOL",
              message: `Unknown tool: ${event.toolName}`,
            });
            const message = buildToolMessage({
              callId: event.callId,
              toolName: event.toolName,
              result,
              status: "error",
              interruptId: event.interruptId,
            });
            toolCallGuard.remember(event.callId, message);
            toolMessages.push(message);
            emitTurnEvent({
              type: "warning",
              message: result.summary,
              callId: event.callId,
              toolName: event.toolName,
              code: "UNKNOWN_TOOL",
            });
            emitTurnEvent({
              type: "tool_completed",
              callId: event.callId,
              toolName: event.toolName,
              argsSummary,
              summary: result.summary,
              status: "error",
              code: "UNKNOWN_TOOL",
            });
            continue;
          }

          const validation = validateToolPayload(tool.name, args, {
            projectRoot: options.session.projectRoot,
          });
          if (!validation.ok) {
            const result = toInvalidToolPayloadResult(validation.error);
            const message = buildToolMessage({
              callId: event.callId,
              toolName: tool.name,
              result,
              status: "error",
              interruptId: event.interruptId,
            });
            toolCallGuard.remember(event.callId, message);
            toolMessages.push(message);
            emitTurnEvent({
              type: "warning",
              message: result.summary,
              callId: event.callId,
              toolName: tool.name,
              code: validation.error.code,
            });
            emitTurnEvent({
              type: "tool_completed",
              callId: event.callId,
              toolName: tool.name,
              argsSummary,
              summary: result.summary,
              status: "error",
              code: validation.error.code,
            });
            continue;
          }

          const validatedArgs = validation.value;
          const decision = await permissions.request(tool.name, validatedArgs, {
            signal: options.signal,
            onPromptRequest: (request) => {
              emitTurnEvent({
                type: "permission_requested",
                callId: event.callId,
                toolName: tool.name,
                riskLevel: request.riskLevel,
                scope: request.scope,
                target: request.target,
                reason: request.reason,
              });
            },
          });
          emitTurnEvent({
            type: "permission_resolved",
            callId: event.callId,
            toolName: tool.name,
            riskLevel: decision.riskLevel,
            decision: decision.outcome,
            scope: decision.scope,
            allowed: decision.allowed,
            target: decision.target,
            reason: decision.reason,
            remembered: decision.remembered,
          });
          if (!decision.allowed) {
            const result = toToolErrorResult({
              code: "PERMISSION_DENIED",
              message: decision.reason
                ? `Permission denied: ${decision.reason}`
                : "Permission denied",
              details: {
                scope: decision.scope,
                riskLevel: decision.riskLevel,
                remembered: decision.remembered ?? false,
              },
            });
            const message = buildToolMessage({
              callId: event.callId,
              toolName: tool.name,
              result,
              status: "error",
              interruptId: event.interruptId,
            });
            toolCallGuard.remember(event.callId, message);
            toolMessages.push(message);
            emitTurnEvent({
              type: "warning",
              message: `denied ${tool.name}`,
              callId: event.callId,
              toolName: tool.name,
              code: "PERMISSION_DENIED",
            });
            emitTurnEvent({
              type: "tool_completed",
              callId: event.callId,
              toolName: tool.name,
              argsSummary,
              summary: result.summary,
              status: "denied",
              code: "PERMISSION_DENIED",
            });
            continue;
          }

          const toolContext: ToolExecutionContext = {
            projectRoot: options.session.projectRoot,
            cwd: options.session.cwd,
            backend: createTurnEventExecutionBackend(backend, {
              callId: event.callId,
              toolName: tool.name,
              emitTurnEvent,
            }),
            permissions,
            session: options.session,
            signal: options.signal,
          };

          try {
            const result = await tool.execute(validatedArgs as never, toolContext);
            const message = buildToolMessage({
              callId: event.callId,
              toolName: tool.name,
              result,
              interruptId: event.interruptId,
            });
            toolCallGuard.remember(event.callId, message);
            toolMessages.push(message);
            emitTurnEvent({
              type: "tool_completed",
              callId: event.callId,
              toolName: tool.name,
              argsSummary,
              summary: result.summary,
              status: "success",
              changedFiles: result.changedFiles,
            });
          } catch (error) {
            if (isAbortError(error)) {
              throw error;
            }
            const result = toToolErrorResult({
              code: "TOOL_EXECUTION_ERROR",
              message: error instanceof Error ? error.message : String(error),
            });
            const message = buildToolMessage({
              callId: event.callId,
              toolName: tool.name,
              result,
              status: "error",
              interruptId: event.interruptId,
            });
            toolCallGuard.remember(event.callId, message);
            toolMessages.push(message);
            emitTurnEvent({
              type: "error",
              message: result.summary,
              callId: event.callId,
              toolName: tool.name,
              code: "TOOL_EXECUTION_ERROR",
            });
            emitTurnEvent({
              type: "tool_completed",
              callId: event.callId,
              toolName: tool.name,
              argsSummary,
              summary: result.summary,
              status: "error",
              code: "TOOL_EXECUTION_ERROR",
            });
          }

          continue;
        }

        if (event.type === "usage") {
          continue;
        }

        if (event.type === "checkpoint") {
          emitTurnEvent({
            type: "checkpoint_updated",
            checkpointId: event.checkpointId,
            threadId: event.threadId,
            runId: event.runId,
          });
          continue;
        }

        if (event.type === "error") {
          const normalizedError = normalizeSdkRequestError(new Error(event.message), {
            operation: requestOperation,
            apiUrl: options.config.apiUrl,
            url: request.requestUrl,
            method: "POST",
            phase: "stream_event",
            preserveMessage: true,
          });
          if (
            requestOperation === "streamPrompt" &&
            pendingToolMessages == null &&
            options.session.threadId &&
            !retriedMissingThread
          ) {
            if (isMissingRemoteThreadError(normalizedError)) {
              retriedMissingThread = true;
              retryWithFreshThread = true;
              options.session.threadId = undefined;
              options.session.runId = undefined;
              options.session.checkpointId = undefined;
              executionId = undefined;
              emitTurnEvent({
                type: "warning",
                message: "previous remote thread was not found; retrying with a new thread",
                code: "STALE_THREAD_RETRY",
              });
              break;
            }

            if (isAmbiguousMissingRecordError(event.message)) {
              const assistantCheck = await maybeResolveAmbiguousMissingRecord({
                sdk,
                config: options.config,
              });

              if (
                isXpertCliRequestError(assistantCheck) &&
                assistantCheck.kind === "assistant_not_found"
              ) {
                throw assistantCheck;
              }

              if (assistantCheck === "assistant_exists") {
                retriedMissingThread = true;
                retryWithFreshThread = true;
                options.session.threadId = undefined;
                options.session.runId = undefined;
                options.session.checkpointId = undefined;
                executionId = undefined;
                emitTurnEvent({
                  type: "warning",
                  message: "previous remote thread was not found; retrying with a new thread",
                  code: "STALE_THREAD_RETRY",
                });
                break;
              }
            }
          }
          throw normalizedError;
        }

        if (event.type === "done") {
          sawDone = true;
          if (state.runId) {
            executionId = state.runId;
            options.session.runId = state.runId;
          }
          if (state.threadId) {
            options.session.threadId = state.threadId;
          }
        }
      }

      if (retryWithFreshThread) {
        continue turnLoop;
      }

      throwIfAborted(options.signal);
      if (!sawDone && toolMessages.length === 0) {
        throw normalizeSdkRequestError(
          new Error("run stream ended before a complete event"),
          {
            operation: requestOperation,
            apiUrl: options.config.apiUrl,
            url: request.requestUrl,
            method: "POST",
            phase: "stream",
          },
        );
      }

      options.session.checkpointId = await sdk.getCheckpoint(
        options.session.threadId ?? failMissingThreadId(),
      );
      emitTurnEvent({
        type: "checkpoint_updated",
        checkpointId: options.session.checkpointId,
        threadId: options.session.threadId,
        runId: options.session.runId,
      });

      if (toolMessages.length === 0) {
        finishTurn({ status: "completed" });
        return options.session;
      }

      pendingToolMessages = toolMessages;
    }
  } catch (error) {
    if (isAbortError(error)) {
      finishTurn({
        status: "cancelled",
        error: "Turn cancelled",
        cancelled: true,
      });
      throw error;
    }

    finishTurn({
      status: "failed",
      error: formatCliError(error),
    });
    throw error;
  }
}

function isTruthy(value: string | undefined): boolean {
  return value === "1" || value === "true";
}

function toToolErrorResult(input: {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}): ToolExecutionResult {
  return {
    summary: input.message,
    content: input.message,
    artifact: {
      code: input.code,
      ...(input.details ?? {}),
    },
  };
}

function stringifyTarget(args: unknown): string | undefined {
  if (!args || typeof args !== "object") {
    return undefined;
  }

  for (const key of ["path", "command", "pattern"]) {
    const value = (args as Record<string, unknown>)[key];
    if (typeof value === "string") {
      return value;
    }
  }

  return undefined;
}

function failMissingExecutionId(): never {
  throw new Error("Missing execution id for tool resume");
}

function failMissingThreadId(): never {
  throw new Error("Missing thread id for turn runtime");
}

function isMissingRemoteThreadError(error: unknown): boolean {
  return (
    isXpertCliRequestError(error) &&
    error.kind === "remote_thread_not_found"
  );
}

function isAmbiguousMissingRecordError(message: string): boolean {
  const normalized = message.trim().toLowerCase();
  return (
    normalized === "the requested record was not found" ||
    normalized === "requested record was not found" ||
    normalized === "record not found" ||
    normalized === "not found"
  );
}

async function maybeResolveAmbiguousMissingRecord(input: {
  sdk: XpertSdkClient;
  config: { assistantId?: string };
}): Promise<XpertCliRequestError | "assistant_exists" | null> {
  if (!input.config.assistantId) {
    return null;
  }

  try {
    await input.sdk.getAssistant(input.config.assistantId);
    return "assistant_exists";
  } catch (error) {
    if (isXpertCliRequestError(error) && error.kind === "assistant_not_found") {
      return error;
    }

    return null;
  }
}

function createTurnEventExecutionBackend(
  backend: ExecutionBackend,
  options: {
    callId: string;
    toolName: string;
    emitTurnEvent: (event: TurnEventInput) => void;
  },
): ExecutionBackend {
  return {
    mode: backend.mode,
    readFile: (filePath, opts) => backend.readFile(filePath, opts),
    glob: (pattern, searchPath) => backend.glob(pattern, searchPath),
    grep: (pattern, searchPath, glob) => backend.grep(pattern, searchPath, glob),
    writeFile: async (args) => {
      const result = await backend.writeFile(args);
      options.emitTurnEvent({
        type: "tool_diff",
        callId: options.callId,
        toolName: options.toolName,
        diffText: result.diff,
        path: result.path,
      });
      return result;
    },
    patchFile: async (args) => {
      const result = await backend.patchFile(args);
      options.emitTurnEvent({
        type: "tool_diff",
        callId: options.callId,
        toolName: options.toolName,
        diffText: result.diff,
        path: result.path,
      });
      return result;
    },
    exec: (command, opts) =>
      backend.exec(command, {
        ...opts,
        onLine: opts?.streamOutput
          ? (line) => {
              options.emitTurnEvent({
                type: "tool_output_line",
                callId: options.callId,
                toolName: options.toolName,
                line,
              });
              opts?.onLine?.(line);
            }
          : opts?.onLine,
      }),
  };
}
