import type { CliSessionState } from "./session-store.js";

export type SessionSelectorMatchType = "exact" | "prefix";

export type SessionSelectorResolution =
  | {
      ok: true;
      selector: string;
      matchType: SessionSelectorMatchType;
      session: CliSessionState;
      matches: CliSessionState[];
    }
  | {
      ok: false;
      selector: string;
      reason: "not_found" | "ambiguous";
      matches: CliSessionState[];
    };

export function findMatchingSessions(
  sessions: readonly CliSessionState[],
  selector: string,
): CliSessionState[] {
  const normalizedSelector = selector.trim();
  if (!normalizedSelector) {
    return [];
  }

  const exactMatches = sessions.filter(
    (session) => session.sessionId === normalizedSelector,
  );
  if (exactMatches.length > 0) {
    return exactMatches;
  }

  return sessions.filter((session) =>
    session.sessionId.startsWith(normalizedSelector),
  );
}

export function resolveSessionSelector(
  sessions: readonly CliSessionState[],
  selector: string,
): SessionSelectorResolution {
  const normalizedSelector = selector.trim();
  const matches = findMatchingSessions(sessions, normalizedSelector);

  if (matches.length === 1) {
    const session = matches[0];
    if (!session) {
      return {
        ok: false,
        selector: normalizedSelector,
        reason: "not_found",
        matches: [],
      };
    }

    return {
      ok: true,
      selector: normalizedSelector,
      matchType: session.sessionId === normalizedSelector ? "exact" : "prefix",
      session,
      matches,
    };
  }

  if (matches.length === 0) {
    return {
      ok: false,
      selector: normalizedSelector,
      reason: "not_found",
      matches,
    };
  }

  return {
    ok: false,
    selector: normalizedSelector,
    reason: "ambiguous",
    matches,
  };
}
