import type { ToolCallSummary } from "@xpert-cli/contracts";
import { PermissionManager } from "./permissions/manager.js";
import { ToolCallGuard } from "./runtime/tool-call-guard.js";
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

  options.session.threadId = await sdk.ensureThread(options.session.threadId);

  let pendingToolMessages: ClientToolMessageInput[] | null = null;
  let executionId = options.session.runId;

  while (true) {
    throwIfAborted(options.signal);

    const state = {
      threadId: options.session.threadId,
      runId: executionId,
    };

    const request = pendingToolMessages
      ? await sdk.resumeWithToolMessages({
          threadId: options.session.threadId,
          executionId: executionId ?? failMissingExecutionId(),
          clientTools: registry.clientTools,
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

    for await (const event of adaptRunStream(request.stream, state)) {
      throwIfAborted(options.signal);

      if (event.type === "text_delta") {
        ui.writeText(event.text);
        continue;
      }

      if (event.type === "reasoning") {
        ui.printReasoning(event.text);
        continue;
      }

      if (event.type === "tool_call") {
        const tool = registry.tools.get(event.toolName);
        const args = event.args;

        const guardDecision = toolCallGuard.begin({
          callId: event.callId,
          toolName: event.toolName,
          args,
        });
        if (guardDecision.kind === "duplicate") {
          ui.printLine();
          ui.printWarning(`reusing cached result for duplicate ${event.toolName} call`);
          toolMessages.push(guardDecision.message);
          continue;
        }

        ui.printLine();
        ui.printToolCall(event.toolName, stringifyTarget(args));

        if (guardDecision.kind === "blocked") {
          const result = toErrorResult(`${guardDecision.reason}. Use the previous result instead.`);
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
          ui.printWarning(result.summary);
          continue;
        }

        if (!tool) {
          const result = toErrorResult(`Unknown tool: ${event.toolName}`);
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
          continue;
        }

        const decision = await permissions.request(tool.name, args);
        if (!decision.allowed) {
          const result = toErrorResult(
            decision.reason
              ? `Permission denied: ${decision.reason}`
              : "Permission denied",
          );
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
          const result = await tool.execute(args as never, toolContext);
          const message = buildToolMessage({
            callId: event.callId,
            toolName: tool.name,
            result,
            interruptId: event.interruptId,
          });
          toolCallGuard.remember(event.callId, message);
          toolMessages.push(message);
          pushSummary(options.session, event, result, "success");
          for (const filePath of result.changedFiles ?? []) {
            options.session.recentFiles = pushRecentFile(options.session.recentFiles, filePath);
          }
          ui.printToolAck(tool.name, result.summary);
        } catch (error) {
          if (isAbortError(error)) {
            throw error;
          }
          const result = toErrorResult(error instanceof Error ? error.message : String(error));
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
          ui.printError(result.summary);
        }

        continue;
      }

      if (event.type === "usage") {
        continue;
      }

      if (event.type === "checkpoint") {
        options.session.checkpointId = event.checkpointId;
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
      }
    }

    ui.printLine();
    throwIfAborted(options.signal);
    options.session.checkpointId = await sdk.getCheckpoint(options.session.threadId);

    if (toolMessages.length === 0) {
      return options.session;
    }

    pendingToolMessages = toolMessages;
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

function toErrorResult(message: string): ToolExecutionResult {
  return {
    summary: message,
    content: message,
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
