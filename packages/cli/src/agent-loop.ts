import type { ToolCallSummary } from "@xpert-cli/contracts";
import { PermissionManager } from "./permissions/manager.js";
import { buildRunLocalContext } from "./context/run-context.js";
import { ToolCallGuard } from "./runtime/tool-call-guard.js";
import {
  pushTurnTranscript,
  summarizeToolArgs,
  TurnTranscriptRecorder,
} from "./runtime/turn-transcript.js";
import {
  ToolCallBudget,
  toToolBudgetExceededResult,
} from "./runtime/tool-budget.js";
import {
  toInvalidToolPayloadResult,
  validateToolPayload,
} from "./runtime/tool-validation.js";
import { isAbortError, throwIfAborted } from "./runtime/turn-control.js";
import { pushRecentFile, pushToolSummary } from "./runtime/working-set.js";
import type { CliSessionState } from "./runtime/session-store.js";
import { buildToolMessage, type ClientToolMessageInput } from "./sdk/tool-resume.js";
import { adaptRunStream } from "./sdk/run-stream.js";
import { XpertSdkClient } from "./sdk/client.js";
import { createToolRegistry } from "./tools/registry.js";
import { HostExecutionBackend } from "./tools/backends/host.js";
import type { ToolExecutionContext, ToolExecutionResult } from "./tools/contracts.js";
import { UiRenderer } from "./ui/renderer.js";
import type { ResolvedXpertCliConfig } from "@xpert-cli/contracts";

export async function runAgentTurn(options: {
  prompt: string;
  config: ResolvedXpertCliConfig;
  session: CliSessionState;
  interactive: boolean;
  signal?: AbortSignal;
}): Promise<CliSessionState> {
  const ui = new UiRenderer({ interactive: options.interactive });
  const backend = new HostExecutionBackend(options.session.projectRoot);
  const permissions = new PermissionManager({
    session: options.session,
    approvalMode: options.config.approvalMode,
    interactive: ui.interactive,
  });
  const sdk = new XpertSdkClient(options.config);
  const registry = createToolRegistry();
  const toolCallGuard = new ToolCallGuard();
  const toolBudget = new ToolCallBudget();
  const transcript = new TurnTranscriptRecorder({
    prompt: options.prompt,
    threadId: options.session.threadId,
    runId: options.session.runId,
    checkpointId: options.session.checkpointId,
  });
  let finalized = false;

  const finalizeTranscript = (input: {
    status: "completed" | "error" | "cancelled";
    error?: string;
    cancelled?: boolean;
  }): void => {
    if (finalized) {
      return;
    }

    transcript.setIdentifiers({
      threadId: options.session.threadId,
      runId: options.session.runId,
      checkpointId: options.session.checkpointId,
    });
    options.session.turns = pushTurnTranscript(
      options.session.turns ?? [],
      transcript.finish({
        status: input.status,
        threadId: options.session.threadId,
        runId: options.session.runId,
        checkpointId: options.session.checkpointId,
        error: input.error,
        cancelled: input.cancelled,
      }),
    );
    finalized = true;
  };

  try {
    options.session.threadId = await sdk.ensureThread(options.session.threadId);
    transcript.setIdentifiers({ threadId: options.session.threadId });

    let pendingToolMessages: ClientToolMessageInput[] | null = null;
    let executionId = options.session.runId;

    while (true) {
      throwIfAborted(options.signal);

      const state = {
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
            threadId: options.session.threadId,
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
              transcript.setIdentifiers({ runId, threadId });
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
              transcript.setIdentifiers({ runId, threadId });
            },
          });

      const toolMessages: ClientToolMessageInput[] = [];

      for await (const event of adaptRunStream(request.stream, state)) {
        throwIfAborted(options.signal);

        if (event.type === "text_delta") {
          ui.writeText(event.text);
          transcript.appendAssistantText(event.text);
          continue;
        }

        if (event.type === "reasoning") {
          ui.printReasoning(event.text);
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
          if (guardDecision.kind === "duplicate") {
            ui.printLine();
            ui.printWarning(`reusing cached result for duplicate ${event.toolName} call`);
            toolMessages.push(guardDecision.message);
            transcript.recordToolEvent({
              callId: event.callId,
              toolName: event.toolName,
              argsSummary,
              resultSummary: "reused cached result",
              status: guardDecision.message.status === "error" ? "error" : "success",
              code: "DUPLICATE_TOOL_CALL_REUSED",
            });
            continue;
          }

          ui.printLine();
          ui.printToolCall(event.toolName, stringifyTarget(args));

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
            pushSummary(options.session, event, result, "error");
            transcript.recordToolEvent({
              callId: event.callId,
              toolName: event.toolName,
              argsSummary,
              resultSummary: result.summary,
              status: "error",
              code: "REPEATED_TOOL_CALL_BLOCKED",
            });
            ui.printWarning(result.summary);
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
            pushSummary(options.session, event, result, "error");
            transcript.recordToolEvent({
              callId: event.callId,
              toolName: event.toolName,
              argsSummary,
              resultSummary: result.summary,
              status: "error",
              code: "TOOL_CALL_BUDGET_EXCEEDED",
            });
            ui.printWarning(result.summary);
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
            pushSummary(options.session, event, result, "error");
            transcript.recordToolEvent({
              callId: event.callId,
              toolName: event.toolName,
              argsSummary,
              resultSummary: result.summary,
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
            pushSummary(options.session, event, result, "error");
            transcript.recordToolEvent({
              callId: event.callId,
              toolName: tool.name,
              argsSummary,
              resultSummary: result.summary,
              status: "error",
              code: validation.error.code,
            });
            ui.printWarning(result.summary);
            continue;
          }

          const validatedArgs = validation.value;
          const decision = await permissions.request(tool.name, validatedArgs);
          transcript.recordPermissionEvent({
            toolName: tool.name,
            riskLevel: decision.riskLevel,
            decision: decision.outcome,
            scope: decision.scope,
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
            pushSummary(options.session, event, result, "denied");
            transcript.recordToolEvent({
              callId: event.callId,
              toolName: tool.name,
              argsSummary,
              resultSummary: result.summary,
              status: "denied",
              code: "PERMISSION_DENIED",
            });
            ui.printWarning(`denied ${tool.name}`);
            continue;
          }

          const toolContext: ToolExecutionContext = {
            projectRoot: options.session.projectRoot,
            cwd: options.session.cwd,
            backend,
            permissions,
            session: options.session,
            ui,
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
            pushSummary(options.session, event, result, "success");
            transcript.recordToolEvent({
              callId: event.callId,
              toolName: tool.name,
              argsSummary,
              resultSummary: result.summary,
              status: "success",
            });
            transcript.addChangedFiles(result.changedFiles);
            for (const filePath of result.changedFiles ?? []) {
              options.session.recentFiles = pushRecentFile(options.session.recentFiles, filePath);
            }
            ui.printToolAck(tool.name, result.summary);
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
            pushSummary(options.session, event, result, "error");
            transcript.recordToolEvent({
              callId: event.callId,
              toolName: tool.name,
              argsSummary,
              resultSummary: result.summary,
              status: "error",
              code: "TOOL_EXECUTION_ERROR",
            });
            ui.printError(result.summary);
          }

          continue;
        }

        if (event.type === "usage") {
          continue;
        }

        if (event.type === "checkpoint") {
          options.session.checkpointId = event.checkpointId;
          transcript.setIdentifiers({
            checkpointId: event.checkpointId,
            threadId: event.threadId,
            runId: event.runId,
          });
          continue;
        }

        if (event.type === "error") {
          ui.printError(event.message);
          throw new Error(event.message);
        }

        if (event.type === "done") {
          if (state.runId) {
            executionId = state.runId;
            options.session.runId = state.runId;
          }
          transcript.setIdentifiers({
            threadId: state.threadId,
            runId: state.runId,
          });
        }
      }

      ui.printLine();
      throwIfAborted(options.signal);
      options.session.checkpointId = await sdk.getCheckpoint(options.session.threadId);
      transcript.setIdentifiers({ checkpointId: options.session.checkpointId });

      if (toolMessages.length === 0) {
        finalizeTranscript({ status: "completed" });
        return options.session;
      }

      pendingToolMessages = toolMessages;
    }
  } catch (error) {
    if (isAbortError(error)) {
      finalizeTranscript({
        status: "cancelled",
        error: "Turn cancelled",
        cancelled: true,
      });
      throw error;
    }

    finalizeTranscript({
      status: "error",
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

function pushSummary(
  session: CliSessionState,
  event: { callId: string; toolName: string },
  result: ToolExecutionResult,
  status: ToolCallSummary["status"],
): void {
  session.recentToolCalls = pushToolSummary(session.recentToolCalls, {
    id: event.callId,
    toolName: event.toolName as ToolCallSummary["toolName"],
    summary: result.summary,
    status,
    createdAt: new Date().toISOString(),
  });
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
