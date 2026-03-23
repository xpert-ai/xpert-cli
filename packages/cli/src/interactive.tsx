import { randomUUID } from "node:crypto";
import { Box, render, useApp, useInput } from "ink";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ResolvedXpertCliConfig } from "@xpert-cli/contracts";
import { runAgentTurn } from "./agent-loop.js";
import { buildRunLocalContext } from "./context/run-context.js";
import { runInterruptibleTurn, TurnCancelledError } from "./runtime/turn-control.js";
import {
  getNextTurnLifecycleState,
  type TurnEvent,
  type TurnLifecycleState,
} from "./runtime/turn-events.js";
import type { CliSessionState, SessionStore } from "./runtime/session-store.js";
import { createToolRegistry } from "./tools/registry.js";
import { runSlashCommand, summarizeGit } from "./ui/commands.js";
import {
  createEmptyPendingTurn,
  materializePendingTurn,
  type PendingTurnState,
  type UiHistoryItem,
  type UiHistoryItemInput,
} from "./ui/history.js";
import { applyTurnEvent } from "./ui/ink-state.js";
import { InkUiSink } from "./ui/ink-sink.js";
import { InlinePermissionController } from "./ui/inline-permission.js";
import { resolveCtrlCAction } from "./ui/ctrl-c.js";
import { Composer } from "./ui/ink/composer.js";
import { Footer } from "./ui/ink/footer.js";
import { MainContent } from "./ui/ink/main-content.js";
import { PermissionPrompt } from "./ui/ink/permission-prompt.js";
import {
  createInputBufferController,
  parseInputChunk,
} from "./ui/input-buffer.js";

const DOUBLE_CTRL_C_WINDOW_MS = 1200;

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
  const toolRegistry = useMemo(() => createToolRegistry(), []);
  const permissionController = useMemo(() => new InlinePermissionController(), []);
  const historyIdRef = useRef(0);
  const cancelActiveTurnRef = useRef<(() => void) | null>(null);
  const sessionRef = useRef(props.session);
  const lastCtrlCAtRef = useRef<number | null>(null);
  const exitAfterTurnRef = useRef(false);
  const pendingRef = useRef<PendingTurnState>(createEmptyPendingTurn());
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
  const [input, setInput] = useState("");
  const [turnLifecycleState, setTurnLifecycleState] = useState<TurnLifecycleState | "idle">(
    "idle",
  );
  const [permissionState, setPermissionState] = useState(
    permissionController.getState(),
  );
  const [gitSummary, setGitSummary] = useState("git unknown");
  const [notice, setNotice] = useState<string>();
  const inputBuffer = useMemo(() => createInputBufferController(setInput), []);

  useEffect(() => {
    sessionRef.current = session;
  }, [session]);

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
        setGitSummary(`git error`);
        setNotice(error instanceof Error ? error.message : String(error));
      }
    },
    [props.config],
  );

  useEffect(() => {
    void refreshStatus(session);
  }, [refreshStatus, session]);

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
          setNotice(message);
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
    addHistoryItem({
      type: "user_prompt",
      text: prompt,
    });

    if (prompt.startsWith("/")) {
      const result = await runSlashCommand(prompt, {
        config: props.config,
        session,
        toolRegistry,
      });

      if (result.type === "exit") {
        await exitInteractive();
        return;
      }

      addHistoryItem(result.item);
      await refreshStatus(session);
      return;
    }

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
            setNotice("cancelled current turn");
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
        addHistoryItem({
          type: "error",
          text: error instanceof Error ? error.message : String(error),
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
    permissionController,
    props.config,
    props.sessionStore,
    refreshStatus,
    resetPending,
    session,
    toolRegistry,
    turnLifecycleState,
    permissionState,
    uiSink,
  ]);

  const turnState = toInteractiveTurnState({
    lifecycleState: turnLifecycleState,
    permissionActive: Boolean(permissionState),
  });

  useInput((value, key) => {
    if (
      key.ctrl &&
      (value === "c" || value === "C" || value === "\u0003")
    ) {
      const action = resolveCtrlCAction({
        turnState,
        now: Date.now(),
        lastCtrlCAt: lastCtrlCAtRef.current ?? undefined,
        windowMs: DOUBLE_CTRL_C_WINDOW_MS,
      });
      lastCtrlCAtRef.current = action.lastCtrlCAt;
      setNotice(action.notice);
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

    if (key.return) {
      lastCtrlCAtRef.current = null;
      void submitPrompt();
      return;
    }

    if (key.backspace || key.delete) {
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
        inputBuffer.append(chunk.text);
      }
      if (chunk.submit) {
        void submitPrompt();
      }
    }
  });

  return (
    <Box flexDirection="column">
      <MainContent history={history} pending={pending} />
      {permissionState ? <PermissionPrompt state={permissionState} /> : null}
      <Composer value={input} turnState={turnState} />
      <Footer
        cwd={session.cwd}
        git={gitSummary}
        sessionId={session.sessionId}
        approvalMode={props.config.approvalMode}
        turnState={turnState}
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
