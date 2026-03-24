import { randomUUID } from "node:crypto";
import { Box, render, useApp, useInput, useStdout } from "ink";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ResolvedXpertCliConfig } from "@xpert-cli/contracts";
import { runAgentTurn } from "./agent-loop.js";
import { buildRunLocalContext } from "./context/run-context.js";
import { runInterruptibleTurn, TurnCancelledError } from "./runtime/turn-control.js";
import { formatCliErrorBody } from "./sdk/request-errors.js";
import {
  getNextTurnLifecycleState,
  type TurnEvent,
  type TurnLifecycleState,
} from "./runtime/turn-events.js";
import type { CliSessionState, SessionStore } from "./runtime/session-store.js";
import { createToolRegistry } from "./tools/registry.js";
import {
  buildSessionPanelData,
  buildStatusPanelData,
  buildToolsPanelData,
  runSlashCommand,
  summarizeGit,
  type InspectorPanel,
  type InspectorPanelData,
} from "./ui/commands.js";
import {
  createEmptyPendingTurn,
  materializePendingTurn,
  type PendingTurnState,
  type UiHistoryItem,
  type UiHistoryItemInput,
} from "./ui/history.js";
import { resolveEscapeAction, resolveInteractiveSlashCommandEffect } from "./ui/interactive-state.js";
import { applyTurnEvent } from "./ui/ink-state.js";
import { InkUiSink } from "./ui/ink-sink.js";
import { InlinePermissionController } from "./ui/inline-permission.js";
import { resolveCtrlCAction } from "./ui/ctrl-c.js";
import { createInputHistoryController } from "./ui/input-history.js";
import { Composer } from "./ui/ink/composer.js";
import { Footer } from "./ui/ink/footer.js";
import { MainContent } from "./ui/ink/main-content.js";
import { PermissionPrompt } from "./ui/ink/permission-prompt.js";
import {
  createInputBufferController,
  parseInputChunk,
} from "./ui/input-buffer.js";
import {
  createViewportState,
  scrollViewportBy,
  scrollViewportToEnd,
  scrollViewportToStart,
  syncViewport,
  viewportStatesEqual,
  type ViewportMetrics,
} from "./ui/viewport.js";
import { resolveInkHeights } from "./ui/ink-layout.js";

const DOUBLE_CTRL_C_WINDOW_MS = 1200;

type InteractiveNotice = {
  level: "info" | "warning" | "error";
  message: string;
};

export async function runInteractiveApp(options: {
  config: ResolvedXpertCliConfig;
  session: CliSessionState;
  sessionStore: SessionStore;
}): Promise<void> {
  const instance = render(<InteractiveApp {...options} />, {
    exitOnCtrlC: false,
  });

  await instance.waitUntilExit();
}

function InteractiveApp(props: {
  config: ResolvedXpertCliConfig;
  session: CliSessionState;
  sessionStore: SessionStore;
}) {
  const { exit } = useApp();
  const { stdout } = useStdout();
  const toolRegistry = useMemo(() => createToolRegistry(), []);
  const permissionController = useMemo(() => new InlinePermissionController(), []);
  const historyIdRef = useRef(0);
  const cancelActiveTurnRef = useRef<(() => void) | null>(null);
  const sessionRef = useRef(props.session);
  const lastCtrlCAtRef = useRef<number | null>(null);
  const exitAfterTurnRef = useRef(false);
  const pendingRef = useRef<PendingTurnState>(createEmptyPendingTurn());
  const [terminalSize, setTerminalSize] = useState(() => getTerminalSize(stdout));
  const [session, setSession] = useState(props.session);
  const [history, setHistory] = useState<UiHistoryItem[]>(() => [
    createHistoryItem("history-0", {
      type: "info",
      text: `xpert session ${props.session.sessionId}`,
    }),
    createHistoryItem("history-1", {
      type: "info",
      text: `cwd: ${props.session.cwd}`,
    }),
    createHistoryItem("history-2", {
      type: "info",
      text: "Commands: /status /tools /session /exit",
    }),
  ]);
  historyIdRef.current = Math.max(historyIdRef.current, history.length);

  const [pending, setPending] = useState<PendingTurnState>(createEmptyPendingTurn());
  const [inspector, setInspector] = useState<InspectorPanelData | null>(null);
  const [historyViewport, setHistoryViewport] = useState(createViewportState());
  const [input, setInput] = useState("");
  const [turnLifecycleState, setTurnLifecycleState] = useState<TurnLifecycleState | "idle">(
    "idle",
  );
  const [permissionState, setPermissionState] = useState(
    permissionController.getState(),
  );
  const [gitSummary, setGitSummary] = useState("git unknown");
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

  const nextHistoryId = useCallback((): string => {
    historyIdRef.current += 1;
    return `history-${historyIdRef.current}`;
  }, []);

  const addHistoryItem = useCallback(
    (item: UiHistoryItemInput) => {
      setHistory((current) => [...current, createHistoryItem(nextHistoryId(), item)]);
    },
    [nextHistoryId],
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
  }, []);

  const resetPending = useCallback(() => {
    const next = createEmptyPendingTurn();
    pendingRef.current = next;
    setPending(next);
  }, []);

  const commitPending = useCallback(() => {
    const items = materializePendingTurn(pendingRef.current, nextHistoryId);
    if (items.length > 0) {
      setHistory((current) => [...current, ...items]);
    }
    resetPending();
  }, [nextHistoryId, resetPending]);

  const refreshStatus = useCallback(
    async (sessionState: CliSessionState) => {
      try {
        const localContext = await buildRunLocalContext({
          config: props.config,
          session: sessionState,
        });
        setGitSummary(summarizeGit(localContext.git));
      } catch (error) {
        setGitSummary("git error");
        setNotice({
          level: "error",
          message: error instanceof Error ? error.message : String(error),
        });
      }
    },
    [props.config],
  );

  const refreshInspector = useCallback(
    async (panel: InspectorPanel, sessionState: CliSessionState) => {
      try {
        switch (panel) {
          case "status":
            setInspector(
              await buildStatusPanelData({
                config: props.config,
                session: sessionState,
                toolRegistry,
                presentation: "ink",
              }),
            );
            return;
          case "tools":
            setInspector(
              buildToolsPanelData({
                config: props.config,
                session: sessionState,
                toolRegistry,
                presentation: "ink",
              }),
            );
            return;
          case "session":
            setInspector(buildSessionPanelData(sessionState));
        }
      } catch (error) {
        setNotice({
          level: "error",
          message: error instanceof Error ? error.message : String(error),
        });
      }
    },
    [props.config, toolRegistry],
  );

  useEffect(() => {
    void refreshStatus(session);
  }, [refreshStatus, session]);

  useEffect(() => {
    if (!inspector?.panel) {
      return;
    }

    void refreshInspector(inspector.panel, session);
  }, [inspector?.panel, refreshInspector, session]);

  useEffect(() => {
    return permissionController.subscribe((state) => {
      setPermissionState(state);
    });
  }, [permissionController]);

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

  const handleHistoryViewportMetrics = useCallback((metrics: ViewportMetrics) => {
    setHistoryViewport((current) => {
      const reason =
        current.wrapWidth !== metrics.wrapWidth ||
        current.viewportHeight !== metrics.viewportHeight
          ? "resize"
          : "content";
      const next = syncViewport(current, metrics, reason);
      return viewportStatesEqual(current, next) ? current : next;
    });
  }, []);

  const scrollHistory = useCallback((action: "page_up" | "page_down" | "home" | "end") => {
    setHistoryViewport((current) => {
      switch (action) {
        case "home":
          return scrollViewportToStart(current);
        case "end":
          return scrollViewportToEnd(current);
        case "page_up":
          return scrollViewportBy(current, -Math.max(1, current.viewportHeight - 1));
        case "page_down":
          return scrollViewportBy(current, Math.max(1, current.viewportHeight - 1));
      }
    });
  }, []);

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
      const result = await runSlashCommand(prompt, {
        config: props.config,
        session,
        toolRegistry,
        presentation: "ink",
      });
      const effect = resolveInteractiveSlashCommandEffect(result);

      if (effect.shouldExit) {
        await exitInteractive();
        return;
      }

      if (effect.panel) {
        setInspector(effect.panel);
        await refreshStatus(session);
        return;
      }

      if (effect.historyItem) {
        addHistoryItem(effect.historyItem);
      }
      await refreshStatus(session);
      return;
    }

    addHistoryItem({
      type: "user_prompt",
      text: prompt,
    });
    resetPending();
    setTurnLifecycleState("running");

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
      await refreshStatus(sessionRef.current);
      if (exitAfterTurnRef.current) {
        exitAfterTurnRef.current = false;
        await exitInteractive();
      }
    }
  }, [
    addHistoryItem,
    commitPending,
    exitInteractive,
    inputBuffer,
    inputHistory,
    permissionController,
    permissionState,
    props.config,
    props.sessionStore,
    refreshStatus,
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
  const permissionLayout = resolveInkHeights({
    terminalHeight: terminalSize.height,
    permissionVisible: Boolean(permissionState),
    permissionChoiceCount: permissionState?.choices.length ?? 0,
    inspectorMode: "hidden",
    inspectorLineCount: 0,
    pendingLineCount: 0,
  });

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

    if (key.escape) {
      const action = resolveEscapeAction({
        permissionActive: false,
        panelOpen: Boolean(inspector),
      });
      if (action === "close_panel") {
        setInspector(null);
        return;
      }
    }

    if (key.pageUp) {
      scrollHistory("page_up");
      return;
    }

    if (key.pageDown) {
      scrollHistory("page_down");
      return;
    }

    if (key.home) {
      scrollHistory("home");
      return;
    }

    if (key.end) {
      scrollHistory("end");
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
    <Box
      flexDirection="column"
      width={terminalSize.width}
      height={terminalSize.height}
      overflow="hidden"
    >
      <MainContent
        terminalWidth={terminalSize.width}
        terminalHeight={terminalSize.height}
        permissionVisible={Boolean(permissionState)}
        permissionChoiceCount={permissionState?.choices.length ?? 0}
        history={history}
        pending={pending}
        inspector={inspector}
        historyViewport={historyViewport}
        onHistoryViewportMetrics={handleHistoryViewportMetrics}
      />
      {permissionState ? (
        <PermissionPrompt
          width={terminalSize.width}
          height={permissionLayout.permissionHeight}
          state={permissionState}
        />
      ) : null}
      <Composer width={terminalSize.width} value={input} turnState={turnState} />
      <Footer
        width={terminalSize.width}
        cwd={session.cwd}
        git={gitSummary}
        sessionId={session.sessionId}
        assistantId={session.assistantId ?? props.config.assistantId}
        approvalMode={props.config.approvalMode}
        turnState={turnState}
        followLatest={historyViewport.follow}
        inspectorPanel={inspector?.panel ?? null}
        notice={notice}
      />
    </Box>
  );
}

function createHistoryItem(id: string, item: UiHistoryItemInput): UiHistoryItem {
  return {
    id: id || randomUUID(),
    ...item,
  };
}

function toInteractiveTurnState(
  input: {
    lifecycleState: TurnLifecycleState | "idle";
    permissionActive: boolean;
  },
): "idle" | "running" | "waiting_permission" {
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
    width: Math.max(40, stdout.columns ?? process.stdout.columns ?? 80),
    height: Math.max(8, stdout.rows ?? process.stdout.rows ?? 24),
  };
}
