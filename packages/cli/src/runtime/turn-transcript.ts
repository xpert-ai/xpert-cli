import { randomUUID } from "node:crypto";
import type { RiskLevel } from "@xpert-cli/contracts";
import type { TurnEvent } from "./turn-events.js";

export const TURN_TRANSCRIPT_LIMITS = {
  maxTurns: 20,
  promptChars: 1_200,
  assistantChars: 2_000,
  toolEvents: 25,
  permissionEvents: 25,
  changedFiles: 20,
  argsSummaryChars: 220,
  resultSummaryChars: 280,
  errorChars: 400,
} as const;

export interface TurnToolEvent {
  at: string;
  callId: string;
  toolName: string;
  argsSummary: string;
  resultSummary?: string;
  status: "success" | "error" | "denied";
  code?: string;
}

export interface TurnPermissionEvent {
  at: string;
  toolName: string;
  riskLevel: RiskLevel;
  decision: string;
  scope?: string;
  target?: string;
  reason?: string;
  remembered?: boolean;
}

export interface TurnTranscript {
  turnId: string;
  prompt: string;
  startedAt: string;
  finishedAt?: string;
  threadId?: string;
  runId?: string;
  checkpointId?: string;
  status: "completed" | "error" | "cancelled";
  assistantText?: string;
  toolEvents: TurnToolEvent[];
  permissionEvents: TurnPermissionEvent[];
  changedFiles: string[];
  error?: string;
  cancelled?: boolean;
}

export class TurnTranscriptRecorder {
  readonly #startedAt: string;
  readonly #turnId: string;
  readonly #prompt: string;
  #assistantText = "";
  #threadId?: string;
  #runId?: string;
  #checkpointId?: string;
  readonly #toolEvents: TurnToolEvent[] = [];
  readonly #permissionEvents: TurnPermissionEvent[] = [];
  readonly #changedFiles = new Set<string>();

  constructor(input: {
    prompt: string;
    threadId?: string;
    runId?: string;
    checkpointId?: string;
  }) {
    this.#turnId = randomUUID();
    this.#startedAt = new Date().toISOString();
    this.#prompt = input.prompt;
    this.#threadId = input.threadId;
    this.#runId = input.runId;
    this.#checkpointId = input.checkpointId;
  }

  appendAssistantText(text: string): void {
    if (!text) {
      return;
    }

    this.#assistantText += text;
  }

  setIdentifiers(input: {
    threadId?: string;
    runId?: string;
    checkpointId?: string;
  }): void {
    if (input.threadId) {
      this.#threadId = input.threadId;
    }
    if (input.runId) {
      this.#runId = input.runId;
    }
    if (input.checkpointId) {
      this.#checkpointId = input.checkpointId;
    }
  }

  consume(event: TurnEvent): void {
    switch (event.type) {
      case "assistant_text_delta":
        this.appendAssistantText(event.text);
        return;
      case "permission_resolved":
        this.recordPermissionEvent({
          toolName: event.toolName,
          riskLevel: event.riskLevel,
          decision: event.decision,
          scope: event.scope,
          target: event.target,
          reason: event.reason,
          remembered: event.remembered,
        });
        return;
      case "tool_completed":
        this.recordToolEvent({
          callId: event.callId,
          toolName: event.toolName,
          argsSummary: event.argsSummary,
          resultSummary: event.summary,
          status: event.status,
          code: event.code,
        });
        this.addChangedFiles(event.changedFiles);
        return;
      default:
        return;
    }
  }

  recordToolEvent(event: Omit<TurnToolEvent, "at" | "argsSummary" | "resultSummary"> & {
    argsSummary: string;
    resultSummary?: string;
  }): void {
    pushLimited(this.#toolEvents, {
      at: new Date().toISOString(),
      callId: event.callId,
      toolName: event.toolName,
      argsSummary: clipInline(event.argsSummary, TURN_TRANSCRIPT_LIMITS.argsSummaryChars),
      resultSummary: clipInlineMaybe(event.resultSummary, TURN_TRANSCRIPT_LIMITS.resultSummaryChars),
      status: event.status,
      ...(event.code ? { code: event.code } : {}),
    }, TURN_TRANSCRIPT_LIMITS.toolEvents);
  }

  recordPermissionEvent(event: Omit<TurnPermissionEvent, "at">): void {
    pushLimited(this.#permissionEvents, {
      at: new Date().toISOString(),
      toolName: event.toolName,
      riskLevel: event.riskLevel,
      decision: event.decision,
      scope: clipInlineMaybe(event.scope, TURN_TRANSCRIPT_LIMITS.argsSummaryChars),
      target: clipInlineMaybe(event.target, TURN_TRANSCRIPT_LIMITS.argsSummaryChars),
      reason: clipInlineMaybe(event.reason, TURN_TRANSCRIPT_LIMITS.resultSummaryChars),
      ...(event.remembered !== undefined ? { remembered: event.remembered } : {}),
    }, TURN_TRANSCRIPT_LIMITS.permissionEvents);
  }

  addChangedFiles(files: string[] | undefined): void {
    for (const filePath of files ?? []) {
      if (!filePath) {
        continue;
      }

      this.#changedFiles.add(filePath);
      while (this.#changedFiles.size > TURN_TRANSCRIPT_LIMITS.changedFiles) {
        const oldest = this.#changedFiles.values().next().value;
        if (!oldest) {
          break;
        }
        this.#changedFiles.delete(oldest);
      }
    }
  }

  finish(input: {
    status: TurnTranscript["status"];
    threadId?: string;
    runId?: string;
    checkpointId?: string;
    error?: string;
    cancelled?: boolean;
  }): TurnTranscript {
    this.setIdentifiers(input);

    return sanitizeTurnTranscript({
      turnId: this.#turnId,
      prompt: this.#prompt,
      startedAt: this.#startedAt,
      finishedAt: new Date().toISOString(),
      threadId: this.#threadId,
      runId: this.#runId,
      checkpointId: this.#checkpointId,
      status: input.status,
      assistantText: this.#assistantText,
      toolEvents: this.#toolEvents,
      permissionEvents: this.#permissionEvents,
      changedFiles: [...this.#changedFiles],
      error: input.error,
      cancelled: input.cancelled,
    });
  }
}

export function pushTurnTranscript(
  current: TurnTranscript[],
  turn: TurnTranscript,
): TurnTranscript[] {
  return sanitizeTurnTranscripts([...current, turn]);
}

export function sanitizeTurnTranscripts(value: unknown): TurnTranscript[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => sanitizeTurnTranscript(item))
    .slice(-TURN_TRANSCRIPT_LIMITS.maxTurns);
}

export function sanitizeTurnTranscript(value: unknown): TurnTranscript {
  const record = isRecord(value) ? value : {};

  return {
    turnId: readString(record.turnId) ?? randomUUID(),
    prompt: clipText(readString(record.prompt) ?? "", TURN_TRANSCRIPT_LIMITS.promptChars),
    startedAt: readString(record.startedAt) ?? new Date().toISOString(),
    finishedAt: readString(record.finishedAt),
    threadId: readString(record.threadId),
    runId: readString(record.runId),
    checkpointId: readString(record.checkpointId),
    status: readTurnStatus(record.status) ?? "completed",
    assistantText: clipTextMaybe(readString(record.assistantText), TURN_TRANSCRIPT_LIMITS.assistantChars),
    toolEvents: sanitizeToolEvents(record.toolEvents),
    permissionEvents: sanitizePermissionEvents(record.permissionEvents),
    changedFiles: sanitizeChangedFiles(record.changedFiles),
    error: clipTextMaybe(readString(record.error), TURN_TRANSCRIPT_LIMITS.errorChars),
    cancelled: record.cancelled === true ? true : undefined,
  };
}

export function summarizeToolArgs(toolName: string, args: unknown): string {
  if (!isRecord(args)) {
    return `${toolName} ${clipInline(stableStringify(args), TURN_TRANSCRIPT_LIMITS.argsSummaryChars)}`;
  }

  switch (toolName) {
    case "Read":
      return joinSummaryParts([
        `path=${readString(args.path) ?? "?"}`,
        typeof args.offset === "number" ? `offset=${args.offset}` : undefined,
        typeof args.limit === "number" ? `limit=${args.limit}` : undefined,
      ]);
    case "Glob":
      return joinSummaryParts([
        `pattern=${readString(args.pattern) ?? "?"}`,
        readString(args.searchPath) ? `searchPath=${readString(args.searchPath)}` : undefined,
      ]);
    case "Grep":
      return joinSummaryParts([
        `pattern=${readString(args.pattern) ?? "?"}`,
        readString(args.searchPath) ? `searchPath=${readString(args.searchPath)}` : undefined,
        readString(args.glob) ? `glob=${readString(args.glob)}` : undefined,
      ]);
    case "Write":
      return joinSummaryParts([
        `path=${readString(args.path) ?? "?"}`,
        typeof args.content === "string" ? `contentChars=${args.content.length}` : undefined,
      ]);
    case "Patch":
      return summarizePatchArgs(args);
    case "Bash":
      return joinSummaryParts([
        `command=${readString(args.command) ?? "?"}`,
        readString(args.cwd) ? `cwd=${readString(args.cwd)}` : undefined,
        typeof args.timeoutMs === "number" ? `timeoutMs=${args.timeoutMs}` : undefined,
      ]);
    case "GitStatus":
      return readString(args.cwd) ? `cwd=${readString(args.cwd)}` : "cwd=project-root";
    case "GitDiff":
      return joinSummaryParts([
        readString(args.path) ? `path=${readString(args.path)}` : undefined,
        typeof args.staged === "boolean" ? `staged=${args.staged}` : undefined,
        readString(args.cwd) ? `cwd=${readString(args.cwd)}` : undefined,
      ]) || "git diff";
    default:
      return clipInline(stableStringify(args), TURN_TRANSCRIPT_LIMITS.argsSummaryChars);
  }
}

function summarizePatchArgs(args: Record<string, unknown>): string {
  const kind = readString(args.kind) ?? (Array.isArray(args.edits) ? "multi" : "replace");
  if (kind === "multi") {
    return joinSummaryParts([
      `path=${readString(args.path) ?? "?"}`,
      "kind=multi",
      Array.isArray(args.edits) ? `edits=${args.edits.length}` : undefined,
    ]);
  }

  if (kind === "range") {
    return joinSummaryParts([
      `path=${readString(args.path) ?? "?"}`,
      "kind=range",
      typeof args.startLine === "number" ? `startLine=${args.startLine}` : undefined,
      typeof args.endLine === "number" ? `endLine=${args.endLine}` : undefined,
    ]);
  }

  return joinSummaryParts([
    `path=${readString(args.path) ?? "?"}`,
    "kind=replace",
    typeof args.replaceAll === "boolean" ? `replaceAll=${args.replaceAll}` : undefined,
  ]);
}

function sanitizeToolEvents(value: unknown): TurnToolEvent[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => {
      const record = isRecord(item) ? item : {};
      return {
        at: readString(record.at) ?? new Date().toISOString(),
        callId: clipInline(readString(record.callId) ?? "unknown", 120),
        toolName: clipInline(readString(record.toolName) ?? "unknown", 80),
        argsSummary: clipInline(readString(record.argsSummary) ?? "", TURN_TRANSCRIPT_LIMITS.argsSummaryChars),
        resultSummary: clipInlineMaybe(readString(record.resultSummary), TURN_TRANSCRIPT_LIMITS.resultSummaryChars),
        status: readToolStatus(record.status) ?? "error",
        code: clipInlineMaybe(readString(record.code), 80),
      };
    })
    .slice(-TURN_TRANSCRIPT_LIMITS.toolEvents);
}

function sanitizePermissionEvents(value: unknown): TurnPermissionEvent[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => {
      const record = isRecord(item) ? item : {};
      return {
        at: readString(record.at) ?? new Date().toISOString(),
        toolName: clipInline(readString(record.toolName) ?? "unknown", 80),
        riskLevel: readRiskLevel(record.riskLevel) ?? "moderate",
        decision: clipInline(readString(record.decision) ?? "unknown", 80),
        scope: clipInlineMaybe(readString(record.scope), TURN_TRANSCRIPT_LIMITS.argsSummaryChars),
        target: clipInlineMaybe(readString(record.target), TURN_TRANSCRIPT_LIMITS.argsSummaryChars),
        reason: clipInlineMaybe(readString(record.reason), TURN_TRANSCRIPT_LIMITS.resultSummaryChars),
        remembered: record.remembered === true ? true : undefined,
      };
    })
    .slice(-TURN_TRANSCRIPT_LIMITS.permissionEvents);
}

function sanitizeChangedFiles(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const unique = new Set<string>();
  for (const item of value) {
    if (typeof item !== "string" || !item.trim()) {
      continue;
    }

    unique.add(clipInline(item, TURN_TRANSCRIPT_LIMITS.argsSummaryChars));
    if (unique.size >= TURN_TRANSCRIPT_LIMITS.changedFiles) {
      break;
    }
  }

  return [...unique];
}

function pushLimited<T>(array: T[], item: T, limit: number): void {
  array.push(item);
  if (array.length > limit) {
    array.splice(0, array.length - limit);
  }
}

function joinSummaryParts(parts: Array<string | undefined>): string {
  return clipInline(
    parts.filter((part): part is string => Boolean(part)).join(", "),
    TURN_TRANSCRIPT_LIMITS.argsSummaryChars,
  );
}

function clipInline(value: string, maxChars: number): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxChars) {
    return normalized;
  }

  const marker = " ...[truncated]... ";
  const head = Math.max(0, Math.floor((maxChars - marker.length) * 0.7));
  const tail = Math.max(0, maxChars - marker.length - head);
  return `${normalized.slice(0, head)}${marker}${normalized.slice(-tail)}`;
}

function clipText(value: string, maxChars: number): string {
  const normalized = value.replace(/\r\n/g, "\n");
  if (normalized.length <= maxChars) {
    return normalized;
  }

  const marker = "\n...[truncated]...\n";
  const head = Math.max(0, Math.floor((maxChars - marker.length) * 0.65));
  const tail = Math.max(0, maxChars - marker.length - head);
  return `${normalized.slice(0, head)}${marker}${normalized.slice(-tail)}`;
}

function clipTextMaybe(value: string | undefined, maxChars: number): string | undefined {
  if (!value) {
    return undefined;
  }

  return clipText(value, maxChars);
}

function clipInlineMaybe(value: string | undefined, maxChars: number): string | undefined {
  if (!value) {
    return undefined;
  }

  return clipInline(value, maxChars);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function readRiskLevel(value: unknown): RiskLevel | undefined {
  return value === "safe" || value === "moderate" || value === "dangerous"
    ? value
    : undefined;
}

function readToolStatus(value: unknown): TurnToolEvent["status"] | undefined {
  return value === "success" || value === "error" || value === "denied"
    ? value
    : undefined;
}

function readTurnStatus(value: unknown): TurnTranscript["status"] | undefined {
  return value === "completed" || value === "error" || value === "cancelled"
    ? value
    : undefined;
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }

  return `{${Object.entries(value)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`)
    .join(",")}}`;
}
