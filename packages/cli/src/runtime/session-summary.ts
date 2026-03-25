import type { CliSessionState } from "./session-store.js";
import type { TurnTranscript } from "./turn-transcript.js";

export const SESSION_SUMMARY_LIMITS = {
  titleChars: 80,
  latestPromptPreviewChars: 96,
} as const;

export type SessionTurnStatus = TurnTranscript["status"] | "empty";

export interface SessionSummary {
  sessionId: string;
  shortId: string;
  title: string;
  latestPromptPreview: string;
  createdAt: string;
  updatedAt: string;
  lastActivityAt: string;
  cwd: string;
  projectRoot: string;
  assistantId?: string;
  turnCount: number;
  lastTurnStatus: SessionTurnStatus;
  hasRemoteState: boolean;
}

export function buildSessionSummary(session: CliSessionState): SessionSummary {
  const firstPrompt = findFirstMeaningfulPrompt(session.turns);
  const latestTurn = session.turns.at(-1);
  const latestPrompt = normalizeInlineText(latestTurn?.prompt);

  return {
    sessionId: session.sessionId,
    shortId: session.sessionId.slice(0, 8),
    title: firstPrompt
      ? clipInlineText(firstPrompt, SESSION_SUMMARY_LIMITS.titleChars)
      : "(empty session)",
    latestPromptPreview: latestPrompt
      ? clipInlineText(latestPrompt, SESSION_SUMMARY_LIMITS.latestPromptPreviewChars)
      : "",
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    lastActivityAt:
      latestTurn?.finishedAt ??
      latestTurn?.startedAt ??
      session.updatedAt,
    cwd: session.cwd,
    projectRoot: session.projectRoot,
    assistantId: session.assistantId,
    turnCount: session.turns.length,
    lastTurnStatus: latestTurn?.status ?? "empty",
    hasRemoteState: Boolean(
      session.threadId || session.runId || session.checkpointId,
    ),
  };
}

export function buildSessionSummaries(
  sessions: readonly CliSessionState[],
): SessionSummary[] {
  return sessions.map((session) => buildSessionSummary(session));
}

function findFirstMeaningfulPrompt(turns: readonly TurnTranscript[]): string | undefined {
  for (const turn of turns) {
    const prompt = normalizeInlineText(turn.prompt);
    if (prompt) {
      return prompt;
    }
  }

  return undefined;
}

function normalizeInlineText(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }

  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > 0 ? normalized : undefined;
}

function clipInlineText(value: string, maxChars: number): string {
  if (value.length <= maxChars) {
    return value;
  }

  return `${value.slice(0, maxChars - 3)}...`;
}
