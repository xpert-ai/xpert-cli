import { randomUUID } from "node:crypto";
import { Box, render, Static, useApp, useInput, useStdout } from "ink";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ResolvedXpertCliConfig } from "@xpert-cli/contracts";
import { runAgentTurn } from "./agent-loop.js";
import {
  filterPersistedTurnRenderItemsForReplay,
  hydrateTurnRenderItems,
  RENDER_TRANSCRIPT_LIMITS,
} from "./runtime/render-transcript.js";
import { runInterruptibleTurn, TurnCancelledError } from "./runtime/turn-control.js";
import { formatCliErrorBody } from "./sdk/request-errors.js";
import {
  getNextTurnLifecycleState,
  type TurnEvent,
  type TurnLifecycleState,
} from "./runtime/turn-events.js";
import type { CliSessionState, SessionStore } from "./runtime/session-store.js";
import { createToolRegistry } from "./tools/registry.js";
import { runSlashCommand, type SlashCommandContext } from "./ui/commands.js";
import {
  createEmptyPendingTurn,
  type PendingTurnState,
  type UiHistoryItem,
  type UiHistoryItemInput,
} from "./ui/history.js";
import {
  createInteractiveStreamBuffers,
  flushInteractiveStreamBuffers,
  streamInteractiveTurnEvent,
} from "./ui/interactive-stream-history.js";
import { applyTurnEvent } from "./ui/ink-state.js";
import { InkUiSink } from "./ui/ink-sink.js";
import { InlinePermissionController } from "./ui/inline-permission.js";
import { resolveCtrlCAction } from "./ui/ctrl-c.js";
import { createInputHistoryController } from "./ui/input-history.js";
import { Composer } from "./ui/ink/composer.js";
import { MainContent } from "./ui/ink/main-content.js";
import { PermissionPrompt } from "./ui/ink/permission-prompt.js";
import { StatusRow } from "./ui/ink/status-row.js";
import {
  createInputBufferController,
  parseInputChunk,
} from "./ui/input-buffer.js";
import { createTuiRuntime, runWithTuiRuntime } from "./ui/tui-runtime.js";
import {
  buildPendingRenderBlocks,
  createCommittedRenderBatch,
  type CommittedRenderBatch,
} from "./ui/render-blocks.js";

const DOUBLE_CTRL_C_WINDOW_MS = 1200;
const MAX_PERMISSION_HEIGHT = 8;

type InteractiveNotice = {
  level: "info" | "warning" | "error";
  message: string;
};

export async function runInteractiveApp(options: {
  config: ResolvedXpertCliConfig;
  session: CliSessionState;
  sessionStore: SessionStore;
}): Promise<void> {
  const runtime = createTuiRuntime({
    mode: "interactive_ink",
  });

  await runWithTuiRuntime(runtime, async () => {
    const instance = render(<InteractiveApp {...options} />, {
      exitOnCtrlC: false,
    });

    await instance.waitUntilExit();
  });
}

function InteractiveApp(props: {
  config: ResolvedXpertCliConfig;
  session: CliSessionState;
  sessionStore: SessionStore;
}) {
  const initialHistory = useMemo(
    () =>
      buildInitialInteractiveHistory(props.session, {
        includeReasoning: isTruthy(process.env.XPERT_CLI_SHOW_REASONING),
      }),
    [props.session],
  );
  const { exit } = useApp();
  const { stdout } = useStdout();
  const toolRegistry = useMemo(() => createToolRegistry(), []);
  const permissionController = useMemo(() => new InlinePermissionController(), []);
  const historyIdRef = useRef(initialHistory.nextHistoryIndex);
  const cancelActiveTurnRef = useRef<(() => void) | null>(null);
  const sessionRef = useRef(props.session);
  const lastCtrlCAtRef = useRef<number | null>(null);
  const exitAfterTurnRef = useRef(false);
  const pendingRef = useRef<PendingTurnState>(createEmptyPendingTurn());
  const streamBuffersRef = useRef(createInteractiveStreamBuffers());
  const [terminalSize, setTerminalSize] = useState(() => getTerminalSize(stdout));
  const [session, setSession] = useState(props.session);
  const [committedHistory, setCommittedHistory] = useState<CommittedRenderBatch[]>(
    initialHistory.batches,
  );
  const [pending, setPending] = useState<PendingTurnState>(createEmptyPendingTurn());
  const [input, setInput] = useState("");
  const [turnLifecycleState, setTurnLifecycleState] = useState<TurnLifecycleState | "idle">(
    "idle",
  );
  const [turnStartedAtMs, setTurnStartedAtMs] = useState<number | undefined>(undefined);
  const [permissionState, setPermissionState] = useState(
    permissionController.getState(),
  );
  const [notice, setNotice] = useState<InteractiveNotice>();
  const inputBuffer = useMemo(() => createInputBufferController(setInput), []);
  const inputHistory = useMemo(() => createInputHistoryController(), []);

  useEffect(() => {
    sessionRef.current = session;
  }, [session]);

  useEffect(() => {
    const handleResize = () => {
      setTerminalSize(getTerminalSize(stdout));
    };
    handleResize();
    stdout.on("resize", handleResize);
    return () => {
      stdout.off("resize", handleResize);
    };
  }, [stdout]);

  useEffect(() => {
    return permissionController.subscribe((state) => {
      setPermissionState(state);
    });
  }, [permissionController]);

  const nextHistoryId = useCallback((): string => {
    const next = historyIdRef.current;
    historyIdRef.current += 1;
    return `history-${next}`;
  }, []);

  const appendHistoryBatch = useCallback((items: UiHistoryItem[]) => {
    const batch = createCommittedRenderBatch(items);
    if (!batch) {
      return;
    }

    setCommittedHistory((current) => [...current, batch]);
  }, []);

  const addHistoryItem = useCallback(
    (item: UiHistoryItemInput) => {
      appendHistoryBatch([createHistoryItem(nextHistoryId(), item)]);
    },
    [appendHistoryBatch, nextHistoryId],
  );

  const addHistoryItems = useCallback(
    (items: UiHistoryItemInput[]) => {
      if (items.length === 0) {
        return;
      }

      appendHistoryBatch(items.map((item) => createHistoryItem(nextHistoryId(), item)));
    },
    [appendHistoryBatch, nextHistoryId],
  );

  const appendTurnEvent = useCallback((event: TurnEvent) => {
    setPending((current) => {
      const next = applyTurnEvent(current, event);
      pendingRef.current = next;
      return next;
    });
    setTurnLifecycleState((current) => {
      if (current === "idle") {
        return getNextTurnLifecycleState("running", event);
      }
      return getNextTurnLifecycleState(current, event);
    });

    const streamUpdate = streamInteractiveTurnEvent(streamBuffersRef.current, event);
    streamBuffersRef.current = streamUpdate.buffers;
    addHistoryItems(streamUpdate.items);
  }, [addHistoryItems]);

  const resetPending = useCallback(() => {
    const next = createEmptyPendingTurn();
    pendingRef.current = next;
    streamBuffersRef.current = createInteractiveStreamBuffers();
    setPending(next);
  }, []);

  const commitPending = useCallback(() => {
    const flushed = flushInteractiveStreamBuffers(streamBuffersRef.current);
    streamBuffersRef.current = flushed.buffers;
    addHistoryItems(flushed.items);
    resetPending();
  }, [addHistoryItems, resetPending]);

  const uiSink = useMemo(
    () =>
      new InkUiSink({
        dispatch: appendTurnEvent,
        onNotice: ({ level, message }) => {
          setNotice({ level, message });
        },
      }),
    [appendTurnEvent],
  );

  const exitInteractive = useCallback(async () => {
    await props.sessionStore.save(sessionRef.current);
    exit();
  }, [exit, props.sessionStore]);

  const submitPrompt = useCallback(async () => {
    const turnState = toInteractiveTurnState({
      lifecycleState: turnLifecycleState,
      permissionActive: Boolean(permissionState),
    });
    if (turnState !== "idle") {
      return;
    }

    const prompt = inputBuffer.takeTrimmedValue();
    if (!prompt) {
      return;
    }

    setNotice(undefined);
    inputHistory.push(prompt);

    if (prompt.startsWith("/")) {
      const slashEffect = await runInteractiveSlashCommand(prompt, {
        config: props.config,
        session,
        toolRegistry,
      });

      if (slashEffect.shouldExit) {
        await exitInteractive();
        return;
      }

      addHistoryItems(slashEffect.historyItems);
      return;
    }

    addHistoryItem({
      type: "user_prompt",
      text: prompt,
    });
    resetPending();
    setTurnLifecycleState("running");
    setTurnStartedAtMs(Date.now());

    try {
      const nextSession = await runInterruptibleTurn(
        (signal) =>
          runAgentTurn({
            prompt,
            config: props.config,
            session,
            interactive: true,
            signal,
            ui: uiSink,
            toolRegistry,
            promptForPermission: (request, signal) =>
              permissionController.request(request, signal),
          }),
        {
          onCancel: () => {
            setNotice({
              level: "info",
              message: "cancelled current turn",
            });
          },
          onStart: (handle) => {
            cancelActiveTurnRef.current = handle.cancel;
          },
          captureSigint: false,
        },
      );

      await props.sessionStore.save(nextSession);
      sessionRef.current = nextSession;
      setSession(nextSession);
    } catch (error) {
      if (error instanceof TurnCancelledError) {
        await props.sessionStore.save(sessionRef.current);
      } else {
        commitPending();
        setNotice(undefined);
        addHistoryItem({
          type: "error",
          text: formatCliErrorBody(error),
        });
        await props.sessionStore.save(sessionRef.current);
      }
    } finally {
      cancelActiveTurnRef.current = null;
      commitPending();
      setTurnLifecycleState("idle");
      setTurnStartedAtMs(undefined);
      if (exitAfterTurnRef.current) {
        exitAfterTurnRef.current = false;
        await exitInteractive();
      }
    }
  }, [
    addHistoryItem,
    addHistoryItems,
    commitPending,
    exitInteractive,
    inputBuffer,
    inputHistory,
    permissionController,
    permissionState,
    props.config,
    props.sessionStore,
    resetPending,
    session,
    toolRegistry,
    turnLifecycleState,
    uiSink,
  ]);

  const turnState = toInteractiveTurnState({
    lifecycleState: turnLifecycleState,
    permissionActive: Boolean(permissionState),
  });
  const pendingBlocks = useMemo(() => buildPendingRenderBlocks(pending), [pending]);

  useInput((value, key) => {
    if (key.ctrl && (value === "c" || value === "C" || value === "\u0003")) {
      const action = resolveCtrlCAction({
        turnState,
        now: Date.now(),
        lastCtrlCAt: lastCtrlCAtRef.current ?? undefined,
        windowMs: DOUBLE_CTRL_C_WINDOW_MS,
      });
      lastCtrlCAtRef.current = action.lastCtrlCAt;
      setNotice({
        level: "info",
        message: action.notice,
      });
      exitAfterTurnRef.current = action.exitAfterTurn;

      if (action.shouldExitNow) {
        void exitInteractive();
        return;
      }

      if (action.shouldCancelTurn) {
        cancelActiveTurnRef.current?.();
      }
      return;
    }

    if (permissionState) {
      if (key.upArrow) {
        permissionController.moveSelection(-1);
        return;
      }
      if (key.downArrow) {
        permissionController.moveSelection(1);
        return;
      }
      if (key.return) {
        permissionController.submitSelection();
        return;
      }
      if (key.escape) {
        permissionController.denySelection();
      }
      return;
    }

    if (turnState !== "idle") {
      return;
    }

    if (key.upArrow) {
      inputBuffer.setValue(inputHistory.previous(inputBuffer.getValue()));
      return;
    }

    if (key.downArrow) {
      inputBuffer.setValue(inputHistory.next(inputBuffer.getValue()));
      return;
    }

    if (key.return) {
      lastCtrlCAtRef.current = null;
      void submitPrompt();
      return;
    }

    if (key.backspace || key.delete) {
      inputHistory.resetBrowsing();
      inputBuffer.backspace();
      return;
    }

    if (key.ctrl && value === "d" && inputBuffer.getValue().length === 0) {
      lastCtrlCAtRef.current = null;
      void exitInteractive();
      return;
    }

    if (!key.ctrl && !key.meta && value) {
      lastCtrlCAtRef.current = null;
      const chunk = parseInputChunk(value);
      if (chunk.text) {
        inputHistory.resetBrowsing();
        inputBuffer.append(chunk.text);
      }
      if (chunk.submit) {
        void submitPrompt();
      }
    }
  });

  return (
    <Box flexDirection="column" width={terminalSize.width}>
      <Static items={committedHistory}>
        {(batch) => <MainContent key={batch.id} width={terminalSize.width} blocks={batch.blocks} />}
      </Static>
      <MainContent width={terminalSize.width} blocks={pendingBlocks} />
      {permissionState ? (
        <PermissionPrompt
          width={terminalSize.width}
          height={resolvePermissionHeight(permissionState)}
          state={permissionState}
        />
      ) : null}
      <StatusRow
        width={terminalSize.width}
        turnState={turnState}
        pendingBlocks={pendingBlocks}
        startedAtMs={turnStartedAtMs}
        notice={notice}
      />
      <Composer width={terminalSize.width} value={input} turnState={turnState} />
    </Box>
  );
}

function createHistoryItem(id: string, item: UiHistoryItemInput): UiHistoryItem {
  return {
    id: id || randomUUID(),
    ...item,
  };
}

export function buildInitialInteractiveHistory(
  session: CliSessionState,
  options?: {
    maxReplayTurns?: number;
    includeReasoning?: boolean;
  },
): {
  batches: CommittedRenderBatch[];
  nextHistoryIndex: number;
} {
  const maxReplayTurns = options?.maxReplayTurns ?? RENDER_TRANSCRIPT_LIMITS.maxReplayTurns;
  const replayTurns =
    maxReplayTurns > 0 ? session.turns.slice(-maxReplayTurns) : [];
  const batches: CommittedRenderBatch[] = [];
  let historyIndex = 0;
  const nextId = () => `history-${historyIndex++}`;

  const bannerBatch = createCommittedRenderBatch(
    buildInteractiveBannerItems(session).map((item) =>
      createHistoryItem(nextId(), item),
    ),
  );
  if (bannerBatch) {
    batches.push(bannerBatch);
  }

  for (const turn of replayTurns) {
    const batch = createReplayCommittedRenderBatch(
      hydrateTurnRenderItems(
        filterPersistedTurnRenderItemsForReplay(turn.renderItems, {
          includeReasoning: options?.includeReasoning,
        }),
        nextId,
      ),
    );
    if (batch) {
      batches.push(batch);
    }
  }

  return {
    batches,
    nextHistoryIndex: historyIndex,
  };
}

function buildInteractiveBannerItems(session: CliSessionState): UiHistoryItemInput[] {
  return [
    {
      type: "info",
      text: `xpert session ${session.sessionId}`,
    },
    {
      type: "info",
      text: `cwd: ${session.cwd}`,
    },
    {
      type: "info",
      text: "Interactive mode is inline. Use your terminal scrollback to review history.",
    },
    {
      type: "info",
      text: "Commands: /status /tools /session /exit",
    },
  ];
}

function createReplayCommittedRenderBatch(
  history: UiHistoryItem[],
): CommittedRenderBatch | null {
  const batch = createCommittedRenderBatch(history);
  if (!batch) {
    return null;
  }

  return {
    ...batch,
    blocks: batch.blocks.map((block) => {
      if (block.kind === "tool_group" && block.status === "running") {
        return {
          ...block,
          status: "idle",
        };
      }
      if (block.kind === "bash_output" && block.status === "running") {
        return {
          ...block,
          status: "idle",
        };
      }
      if (block.kind === "diff_preview" && block.status === "running") {
        return {
          ...block,
          status: "idle",
        };
      }
      return block;
    }),
  };
}

function toInteractiveTurnState(input: {
  lifecycleState: TurnLifecycleState | "idle";
  permissionActive: boolean;
}): "idle" | "running" | "waiting_permission" {
  if (input.permissionActive) {
    return "waiting_permission";
  }

  if (input.lifecycleState === "running") {
    return "running";
  }

  return "idle";
}

function getTerminalSize(stdout: NodeJS.WriteStream): {
  width: number;
  height: number;
} {
  return {
    width: Math.max(1, stdout.columns ?? process.stdout.columns ?? 80),
    height: Math.max(1, stdout.rows ?? process.stdout.rows ?? 24),
  };
}

function resolvePermissionHeight(input: {
  choices: Array<unknown>;
}): number {
  return Math.min(MAX_PERMISSION_HEIGHT, Math.max(2, input.choices.length + 2));
}

export async function runInteractiveSlashCommand(
  input: string,
  context: Omit<SlashCommandContext, "presentation">,
): Promise<{
  shouldExit: boolean;
  historyItems: UiHistoryItemInput[];
}> {
  const result = await runSlashCommand(input, {
    ...context,
    presentation: "text",
  });

  if (result.type === "exit") {
    return {
      shouldExit: true,
      historyItems: [],
    };
  }

  if (result.type === "history") {
    return {
      shouldExit: false,
      historyItems: [result.item],
    };
  }

  return {
    shouldExit: false,
    historyItems: [
      {
        type: "warning",
        text: `Interactive mode expected inline output for /${result.panel}.`,
      },
    ],
  };
}

function isTruthy(value: string | undefined): boolean {
  return value === "1" || value === "true";
}
