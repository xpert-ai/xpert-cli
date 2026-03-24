import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { PermissionRecord, ToolCallSummary, RiskLevel } from "@xpert-cli/contracts";
import {
  sanitizeTurnTranscripts,
  type TurnTranscript,
} from "./turn-transcript.js";

export interface CliRemoteFingerprint {
  apiUrl?: string;
  organizationId?: string;
  assistantId?: string;
}

export interface CliSessionState {
  sessionId: string;
  threadId?: string;
  runId?: string;
  checkpointId?: string;
  assistantId?: string;
  remoteFingerprint?: CliRemoteFingerprint;
  cwd: string;
  projectRoot: string;
  recentFiles: string[];
  recentToolCalls: ToolCallSummary[];
  approvals: PermissionRecord[];
  turns: TurnTranscript[];
  createdAt: string;
  updatedAt: string;
}

export class SessionStore {
  readonly #sessionDir: string;

  constructor(userConfigDir: string) {
    this.#sessionDir = path.join(userConfigDir, "sessions");
  }

  get sessionDir(): string {
    return this.#sessionDir;
  }

  async ensure(): Promise<void> {
    await mkdir(this.#sessionDir, { recursive: true });
  }

  async create(input: {
    cwd: string;
    projectRoot: string;
    assistantId?: string;
  }): Promise<CliSessionState> {
    const now = new Date().toISOString();
    return {
      sessionId: randomUUID(),
      assistantId: input.assistantId,
      cwd: input.cwd,
      projectRoot: input.projectRoot,
      recentFiles: [],
      recentToolCalls: [],
      approvals: [],
      turns: [],
      createdAt: now,
      updatedAt: now,
    };
  }

  async load(sessionId: string): Promise<CliSessionState | null> {
    try {
      const raw = await readFile(this.getSessionPath(sessionId), "utf8");
      return normalizeSessionState(JSON.parse(raw));
    } catch {
      return null;
    }
  }

  async list(): Promise<CliSessionState[]> {
    await this.ensure();
    const { readdir } = await import("node:fs/promises");
    const entries = await readdir(this.#sessionDir, { withFileTypes: true });
    const sessions = await Promise.all(
      entries
        .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
        .map((entry) => this.load(entry.name.replace(/\.json$/, ""))),
    );

    return sessions
      .filter((item): item is CliSessionState => Boolean(item))
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }

  async resolveLatest(): Promise<CliSessionState | null> {
    const sessions = await this.list();
    return sessions[0] ?? null;
  }

  async resolveLatestForProjectRoot(projectRoot: string): Promise<CliSessionState | null> {
    const normalizedRoot = path.resolve(projectRoot);
    const sessions = await this.list();
    return (
      sessions.find((session) => path.resolve(session.projectRoot) === normalizedRoot) ??
      null
    );
  }

  async save(session: CliSessionState): Promise<void> {
    await this.ensure();
    const payload = normalizeSessionState({
      ...session,
      updatedAt: new Date().toISOString(),
    });
    await writeFile(
      this.getSessionPath(payload.sessionId),
      `${JSON.stringify(payload, null, 2)}\n`,
      "utf8",
    );
  }

  getSessionPath(sessionId: string): string {
    return path.join(this.#sessionDir, `${sessionId}.json`);
  }
}

function normalizeSessionState(raw: unknown): CliSessionState {
  const record = isRecord(raw) ? raw : {};
  const now = new Date().toISOString();

  return {
    sessionId: readString(record.sessionId) ?? randomUUID(),
    threadId: readString(record.threadId),
    runId: readString(record.runId),
    checkpointId: readString(record.checkpointId),
    assistantId: readString(record.assistantId),
    remoteFingerprint: normalizeRemoteFingerprint(record.remoteFingerprint),
    cwd: readString(record.cwd) ?? process.cwd(),
    projectRoot: readString(record.projectRoot) ?? process.cwd(),
    recentFiles: normalizeRecentFiles(record.recentFiles),
    recentToolCalls: normalizeToolSummaries(record.recentToolCalls),
    approvals: normalizeApprovalRecords(record.approvals),
    turns: sanitizeTurnTranscripts(record.turns),
    createdAt: readString(record.createdAt) ?? now,
    updatedAt: readString(record.updatedAt) ?? now,
  };
}

function normalizeRemoteFingerprint(value: unknown): CliRemoteFingerprint | undefined {
  const record = isRecord(value) ? value : null;
  if (!record) {
    return undefined;
  }

  const apiUrl = readString(record.apiUrl);
  const organizationId = readString(record.organizationId);
  const assistantId = readString(record.assistantId);

  if (!apiUrl && !organizationId && !assistantId) {
    return undefined;
  }

  return {
    ...(apiUrl ? { apiUrl } : {}),
    ...(organizationId ? { organizationId } : {}),
    ...(assistantId ? { assistantId } : {}),
  };
}

function normalizeRecentFiles(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
}

function normalizeToolSummaries(value: unknown): ToolCallSummary[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => {
      const record = isRecord(item) ? item : {};
      const status = record.status;
      if (
        typeof record.id !== "string" ||
        typeof record.toolName !== "string" ||
        typeof record.summary !== "string" ||
        (status !== "success" && status !== "error" && status !== "denied") ||
        typeof record.createdAt !== "string"
      ) {
        return null;
      }

      return {
        id: record.id,
        toolName: record.toolName as ToolCallSummary["toolName"],
        summary: record.summary,
        status,
        createdAt: record.createdAt,
      };
    })
    .filter((item): item is ToolCallSummary => Boolean(item));
}

function normalizeApprovalRecords(value: unknown): PermissionRecord[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => normalizeApprovalRecord(item))
    .filter((item): item is PermissionRecord => Boolean(item));
}

function normalizeApprovalRecord(value: unknown): PermissionRecord | null {
  const record = isRecord(value) ? value : null;
  if (!record || typeof record.decision !== "string" || typeof record.createdAt !== "string") {
    return null;
  }

  if (record.toolName && typeof record.toolName === "string" && typeof record.scopeType === "string") {
    return {
      toolName: record.toolName,
      decision: record.decision === "deny" ? "deny" : "allow",
      riskLevel: normalizeRiskLevel(record.riskLevel),
      scopeType: normalizeScopeType(record.scopeType),
      ...(typeof record.path === "string" ? { path: record.path } : {}),
      ...(typeof record.cwd === "string" ? { cwd: record.cwd } : {}),
      ...(typeof record.command === "string" ? { command: record.command } : {}),
      ...(typeof record.target === "string" ? { target: record.target } : {}),
      ...(typeof record.legacyKey === "string" ? { legacyKey: record.legacyKey } : {}),
      createdAt: record.createdAt,
    };
  }

  if (typeof record.key === "string") {
    const toolName = parseLegacyToolName(record.key);
    if (!toolName) {
      return null;
    }

    return {
      toolName,
      decision: record.decision === "deny" ? "deny" : "allow",
      riskLevel: "moderate",
      scopeType: "legacy",
      legacyKey: record.key,
      createdAt: record.createdAt,
    };
  }

  return null;
}

function parseLegacyToolName(key: string): PermissionRecord["toolName"] | null {
  const [toolName] = key.split(":", 1);
  if (!toolName) {
    return null;
  }
  return isToolName(toolName) ? toolName : null;
}

function isToolName(value: string): value is PermissionRecord["toolName"] {
  return [
    "Read",
    "Glob",
    "Grep",
    "Write",
    "Patch",
    "Bash",
    "GitStatus",
    "GitDiff",
  ].includes(value);
}

function normalizeRiskLevel(value: unknown): RiskLevel {
  return value === "safe" || value === "moderate" || value === "dangerous"
    ? value
    : "moderate";
}

function normalizeScopeType(value: unknown): PermissionRecord["scopeType"] {
  return value === "path" || value === "command" || value === "tool" || value === "legacy"
    ? value
    : "tool";
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === "object" && value !== null;
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}
