import type { ResolvedXpertCliConfig } from "@xpert-cli/contracts";
import type {
  CliRemoteFingerprint,
  CliSessionState,
} from "./session-store.js";

export type RemoteFingerprintChangeReason =
  | "api_url_changed"
  | "organization_changed"
  | "assistant_changed";

export interface RemoteSessionResetResult {
  fingerprint: CliRemoteFingerprint;
  changed: boolean;
  reasons: RemoteFingerprintChangeReason[];
  cleared: boolean;
  notice?: string;
}

export function buildRemoteFingerprint(
  config: Pick<ResolvedXpertCliConfig, "apiUrl" | "organizationId" | "assistantId">,
): CliRemoteFingerprint {
  return {
    apiUrl: config.apiUrl,
    ...(config.organizationId ? { organizationId: config.organizationId } : {}),
    ...(config.assistantId ? { assistantId: config.assistantId } : {}),
  };
}

export function applyRemoteConfigToSession(
  session: CliSessionState,
  config: Pick<ResolvedXpertCliConfig, "apiUrl" | "organizationId" | "assistantId">,
): CliRemoteFingerprint {
  const fingerprint = buildRemoteFingerprint(config);
  session.assistantId = config.assistantId;
  session.remoteFingerprint = fingerprint;
  return fingerprint;
}

export function resetStaleRemoteStateIfNeeded(
  session: CliSessionState,
  config: Pick<ResolvedXpertCliConfig, "apiUrl" | "organizationId" | "assistantId">,
): RemoteSessionResetResult {
  const fingerprint = buildRemoteFingerprint(config);
  const reasons = diffRemoteFingerprints(readStoredFingerprint(session), fingerprint);
  const hadRemoteState = Boolean(session.threadId || session.runId || session.checkpointId);

  if (reasons.length > 0) {
    session.threadId = undefined;
    session.runId = undefined;
    session.checkpointId = undefined;
  }

  applyRemoteConfigToSession(session, config);

  return {
    fingerprint,
    changed: reasons.length > 0,
    reasons,
    cleared: reasons.length > 0 && hadRemoteState,
    notice:
      reasons.length > 0 && hadRemoteState
        ? "remote config changed; stale remote run state cleared"
        : undefined,
  };
}

function readStoredFingerprint(session: CliSessionState): CliRemoteFingerprint | undefined {
  if (session.remoteFingerprint) {
    return session.remoteFingerprint;
  }

  if (!session.assistantId) {
    return undefined;
  }

  // Legacy sessions only stored assistantId. Treat missing fields as changed if the
  // current runtime now provides them so stale remote ids do not leak across config
  // migrations.
  return {
    assistantId: session.assistantId,
  };
}

function diffRemoteFingerprints(
  previous: CliRemoteFingerprint | undefined,
  next: CliRemoteFingerprint,
): RemoteFingerprintChangeReason[] {
  if (!previous) {
    return [];
  }

  const reasons: RemoteFingerprintChangeReason[] = [];

  if (normalizeValue(previous.apiUrl) !== normalizeValue(next.apiUrl)) {
    reasons.push("api_url_changed");
  }

  if (normalizeValue(previous.organizationId) !== normalizeValue(next.organizationId)) {
    reasons.push("organization_changed");
  }

  if (normalizeValue(previous.assistantId) !== normalizeValue(next.assistantId)) {
    reasons.push("assistant_changed");
  }

  return reasons;
}

function normalizeValue(value: string | undefined): string {
  return value ?? "";
}
