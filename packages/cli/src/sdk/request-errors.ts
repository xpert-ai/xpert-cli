export type SdkRequestOperation =
  | "ensureThread"
  | "streamPrompt"
  | "resumeWithToolMessages"
  | "getCheckpoint";

export type CliRequestFailureKind =
  | "service_unavailable"
  | "auth_failed"
  | "not_found"
  | "protocol_error"
  | "stream_connect_failed"
  | "stream_interrupted"
  | "resume_failed"
  | "request_failed";

export interface NormalizeSdkRequestErrorInput {
  operation: SdkRequestOperation;
  apiUrl?: string;
  url?: string;
  method?: string;
  statusCode?: number;
  responseBody?: string;
  phase?: "request" | "sse_connect" | "stream" | "stream_event";
  preserveMessage?: boolean;
}

export class XpertCliRequestError extends Error {
  readonly kind: CliRequestFailureKind;
  readonly detail?: string;
  readonly suggestions: string[];
  readonly retryable: boolean;
  readonly statusCode?: number;
  readonly url?: string;
  readonly operation: SdkRequestOperation;

  constructor(
    input: {
      kind: CliRequestFailureKind;
      message: string;
      detail?: string;
      suggestions: string[];
      retryable: boolean;
      statusCode?: number;
      url?: string;
      operation: SdkRequestOperation;
    },
    options?: { cause?: unknown },
  ) {
    super(input.message, options);
    this.name = "XpertCliRequestError";
    this.kind = input.kind;
    this.detail = input.detail;
    this.suggestions = input.suggestions;
    this.retryable = input.retryable;
    this.statusCode = input.statusCode;
    this.url = input.url;
    this.operation = input.operation;
  }
}

export function isXpertCliRequestError(error: unknown): error is XpertCliRequestError {
  return error instanceof XpertCliRequestError;
}

export function formatSdkRequestError(error: XpertCliRequestError): string {
  const lines = [`error: ${error.message}`];
  if (error.detail) {
    lines.push(`detail: ${error.detail}`);
  }
  for (const suggestion of error.suggestions) {
    lines.push(`hint: ${suggestion}`);
  }
  return lines.join("\n");
}

export function formatCliError(error: unknown): string {
  if (isXpertCliRequestError(error)) {
    return formatSdkRequestError(error);
  }
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

export function normalizeSdkRequestError(
  error: unknown,
  input: NormalizeSdkRequestErrorInput,
): XpertCliRequestError {
  if (isXpertCliRequestError(error)) {
    return error;
  }

  const statusCode = readStatusCode(error) ?? input.statusCode;
  const apiUrl = cleanValue(input.apiUrl);
  const url = cleanValue(input.url);
  const responseSummary = summarizeResponseBody(readErrorText(error) ?? input.responseBody);
  const rawMessage = pickErrorMessage(error);
  const invalidUrl = looksLikeInvalidUrl(error, rawMessage);
  const kind = classifyRequestFailure({
    error,
    rawMessage,
    statusCode,
    operation: input.operation,
    phase: input.phase,
    responseSummary,
  });
  const message = buildPrimaryMessage(kind, {
    operation: input.operation,
    apiUrl,
    statusCode,
    invalidUrl,
    rawMessage,
    preserveMessage: input.preserveMessage ?? false,
  });
  const detail = buildDetail({
    kind,
    apiUrl,
    url,
    method: cleanValue(input.method),
    responseSummary,
    rawMessage,
    invalidUrl,
    preserveMessage: input.preserveMessage ?? false,
  });

  return new XpertCliRequestError(
    {
      kind,
      message,
      detail,
      suggestions: buildSuggestions(kind),
      retryable: isRetryable(kind),
      statusCode,
      url,
      operation: input.operation,
    },
    { cause: error },
  );
}

export function isAbortLikeError(error: unknown): boolean {
  const name = readProperty(error, "name");
  const message = pickErrorMessage(error)?.toLowerCase() ?? "";
  return (
    name === "AbortError" ||
    message.startsWith("aborterror") ||
    message.startsWith("cancel") ||
    message.includes("aborted")
  );
}

function classifyRequestFailure(input: {
  error: unknown;
  rawMessage?: string;
  statusCode?: number;
  operation: SdkRequestOperation;
  phase?: NormalizeSdkRequestErrorInput["phase"];
  responseSummary?: string;
}): CliRequestFailureKind {
  if (looksLikeInvalidUrl(input.error, input.rawMessage)) {
    return "request_failed";
  }

  if (looksLikeAuthFailureMessage(input.rawMessage)) {
    return "auth_failed";
  }

  if (input.statusCode === 401 || input.statusCode === 403) {
    return "auth_failed";
  }

  if (input.statusCode === 404) {
    return "not_found";
  }

  if (input.phase === "stream") {
    return input.operation === "resumeWithToolMessages"
      ? "resume_failed"
      : "stream_interrupted";
  }

  if (input.phase === "sse_connect" && looksLikeProtocolIssue(input.error, input.responseSummary)) {
    return "protocol_error";
  }

  if (input.phase === "sse_connect") {
    return "stream_connect_failed";
  }

  if (isServiceUnavailableError(input.error, input.rawMessage)) {
    return "service_unavailable";
  }

  if (looksLikeProtocolIssue(input.error, input.responseSummary, input.statusCode)) {
    return "protocol_error";
  }

  if (input.operation === "resumeWithToolMessages") {
    return "resume_failed";
  }

  return "request_failed";
}

function buildPrimaryMessage(
  kind: CliRequestFailureKind,
  input: {
    operation: SdkRequestOperation;
    apiUrl?: string;
    statusCode?: number;
    invalidUrl?: boolean;
    rawMessage?: string;
    preserveMessage: boolean;
  },
): string {
  const statusSuffix = input.statusCode ? ` (${input.statusCode})` : "";
  const targetSuffix = input.apiUrl ? ` at ${input.apiUrl}` : "";
  const forTargetSuffix = input.apiUrl ? ` for ${input.apiUrl}` : "";
  const action = describeOperation(input.operation);

  if (input.preserveMessage && input.rawMessage && !isGenericMessage(input.rawMessage)) {
    return input.rawMessage;
  }

  switch (kind) {
    case "service_unavailable":
      return input.apiUrl
        ? `cannot reach xpert-pro at ${input.apiUrl}`
        : `cannot reach xpert-pro while trying to ${action}`;
    case "auth_failed":
      return `authentication failed while trying to ${action}${statusSuffix}${forTargetSuffix}`;
    case "not_found":
      return `xpert-pro endpoint not found while trying to ${action}${statusSuffix}${targetSuffix}`;
    case "protocol_error":
      return `xpert-pro returned an incompatible response while trying to ${action}${statusSuffix}`;
    case "stream_connect_failed":
      return input.operation === "resumeWithToolMessages"
        ? `could not reopen the run stream for tool results${targetSuffix}`
        : `could not establish the run stream${targetSuffix}`;
    case "stream_interrupted":
      return "run stream was interrupted before the turn completed";
    case "resume_failed":
      return "tool results could not be resumed to the current run";
    case "request_failed":
      if (input.apiUrl && input.invalidUrl) {
        return `invalid XPERT_API_URL: ${input.apiUrl}`;
      }
      return `request failed while trying to ${action}${statusSuffix}`;
  }
}

function buildDetail(input: {
  kind: CliRequestFailureKind;
  apiUrl?: string;
  url?: string;
  method?: string;
  responseSummary?: string;
  rawMessage?: string;
  invalidUrl?: boolean;
  preserveMessage: boolean;
}): string | undefined {
  if (input.kind === "request_failed" && input.apiUrl && input.invalidUrl) {
    return `XPERT_API_URL=${input.apiUrl}`;
  }

  const requestTarget = input.url
    ? input.method
      ? `${input.method} ${input.url}`
      : input.url
    : undefined;
  const reason = summarizeResponseBody(input.responseSummary ?? input.rawMessage);

  if (input.preserveMessage && requestTarget) {
    return clipDetail(requestTarget);
  }

  if (requestTarget && reason && !reason.includes(requestTarget)) {
    return clipDetail(`${requestTarget}: ${reason}`);
  }

  if (requestTarget) {
    return clipDetail(requestTarget);
  }

  if (reason) {
    return clipDetail(reason);
  }

  if (input.apiUrl) {
    return `XPERT_API_URL=${input.apiUrl}`;
  }

  return undefined;
}

function buildSuggestions(kind: CliRequestFailureKind): string[] {
  switch (kind) {
    case "service_unavailable":
      return [
        "start the backend or check XPERT_API_URL",
        "run xpert doctor",
      ];
    case "auth_failed":
      return [
        "check XPERT_API_KEY and XPERT_AGENT_ID",
        "run xpert auth status",
      ];
    case "not_found":
      return [
        "check XPERT_API_URL points to the xpert-pro /api/ai endpoint",
        "verify the xpert-pro version matches this CLI protocol",
      ];
    case "protocol_error":
      return [
        "check XPERT_API_URL and backend protocol compatibility",
        "retry after aligning the xpert-cli and xpert-pro versions",
      ];
    case "stream_connect_failed":
      return [
        "check the backend logs and XPERT_API_URL",
        "retry the turn or run xpert doctor",
      ];
    case "stream_interrupted":
      return [
        "retry the turn after checking the backend logs",
        "run xpert doctor if the stream keeps dropping",
      ];
    case "resume_failed":
      return [
        "retry the turn after checking the backend logs",
        "check XPERT_API_KEY, XPERT_AGENT_ID, and XPERT_API_URL",
      ];
    case "request_failed":
      return [
        "check XPERT_API_URL",
        "run xpert doctor",
      ];
  }
}

function isRetryable(kind: CliRequestFailureKind): boolean {
  return (
    kind === "service_unavailable" ||
    kind === "stream_connect_failed" ||
    kind === "stream_interrupted" ||
    kind === "resume_failed"
  );
}

function describeOperation(operation: SdkRequestOperation): string {
  switch (operation) {
    case "ensureThread":
      return "create a thread";
    case "streamPrompt":
      return "start the run stream";
    case "resumeWithToolMessages":
      return "resume tool results";
    case "getCheckpoint":
      return "load the checkpoint";
  }
}

function looksLikeProtocolIssue(
  error: unknown,
  responseSummary?: string,
  statusCode?: number,
): boolean {
  if (typeof statusCode === "number" && [400, 405, 406, 409, 410, 415, 422, 426].includes(statusCode)) {
    return true;
  }

  const name = readProperty(error, "name");
  if (name === "SyntaxError") {
    return true;
  }

  const text = `${responseSummary ?? ""} ${pickErrorMessage(error) ?? ""}`.toLowerCase();
  return (
    text.includes("text/event-stream") ||
    text.includes("content-type") ||
    text.includes("unexpected token") ||
    text.includes("json") ||
    text.includes("parse")
  );
}

function isServiceUnavailableError(error: unknown, rawMessage?: string): boolean {
  const codes = collectErrorCodes(error);
  if (
    codes.some((code) =>
      [
        "ECONNREFUSED",
        "ENOTFOUND",
        "EAI_AGAIN",
        "ETIMEDOUT",
        "ECONNRESET",
        "ENETUNREACH",
        "EHOSTUNREACH",
        "UND_ERR_CONNECT_TIMEOUT",
        "UND_ERR_SOCKET",
      ].includes(code),
    )
  ) {
    return true;
  }

  const text = rawMessage?.toLowerCase() ?? "";
  return (
    text.includes("fetch failed") ||
    text.includes("networkerror") ||
    text.includes("connection refused") ||
    text.includes("timed out") ||
    text.includes("timeout") ||
    text.includes("network is unreachable") ||
    text.includes("getaddrinfo") ||
    text.includes("enotfound") ||
    text.includes("econnrefused") ||
    text.includes("ehostunreach") ||
    text.includes("enetunreach")
  );
}

function looksLikeInvalidUrl(error: unknown, rawMessage?: string): boolean {
  const code = readProperty(error, "code");
  const text = `${rawMessage ?? ""} ${readProperty(error, "message") ?? ""}`.toLowerCase();
  return code === "ERR_INVALID_URL" || text.includes("invalid url");
}

function looksLikeAuthFailureMessage(rawMessage?: string): boolean {
  const text = rawMessage?.toLowerCase() ?? "";
  return (
    text === "unauthorized" ||
    text === "forbidden" ||
    text.includes("authentication failed") ||
    text.includes("invalid api key") ||
    text.includes("unauthorized") ||
    text.includes("forbidden")
  );
}

function readStatusCode(error: unknown): number | undefined {
  const direct = readNumberProperty(error, "status");
  if (typeof direct === "number") {
    return direct;
  }

  const message = pickErrorMessage(error);
  if (!message) {
    return undefined;
  }

  const match = /^HTTP\s+(?<status>\d{3})/i.exec(message);
  if (!match?.groups?.status) {
    return undefined;
  }

  return Number.parseInt(match.groups.status, 10);
}

function pickErrorMessage(error: unknown): string | undefined {
  for (const candidate of collectErrorRecords(error)) {
    const text = summarizeResponseBody(readProperty(candidate, "message"));
    if (text && !isGenericMessage(text)) {
      return text;
    }
  }

  for (const candidate of collectErrorRecords(error)) {
    const text = summarizeResponseBody(readProperty(candidate, "message"));
    if (text) {
      return text;
    }
  }

  return undefined;
}

function readErrorText(error: unknown): string | undefined {
  for (const candidate of collectErrorRecords(error)) {
    const text = summarizeResponseBody(readProperty(candidate, "text"));
    if (text) {
      return text;
    }
  }
  return undefined;
}

function collectErrorCodes(error: unknown): string[] {
  const codes = new Set<string>();

  for (const candidate of collectErrorRecords(error)) {
    const code = readProperty(candidate, "code");
    if (code) {
      codes.add(code);
    }
  }

  return [...codes];
}

function collectErrorRecords(error: unknown): Array<Record<string, unknown>> {
  const records: Array<Record<string, unknown>> = [];
  const seen = new Set<unknown>();
  let current: unknown = error;
  let depth = 0;

  while (current && typeof current === "object" && depth < 6 && !seen.has(current)) {
    seen.add(current);
    records.push(current as Record<string, unknown>);
    current = (current as Record<string, unknown>).cause;
    depth += 1;
  }

  return records;
}

function summarizeResponseBody(value: unknown): string | undefined {
  const text = cleanValue(value);
  if (!text) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(text) as {
      message?: string | string[];
      error?: string;
      detail?: string;
    };
    if (Array.isArray(parsed.message)) {
      return clipDetail(parsed.message.join("; "));
    }
    if (typeof parsed.message === "string" && parsed.message.trim()) {
      return clipDetail(parsed.message);
    }
    if (typeof parsed.error === "string" && parsed.error.trim()) {
      return clipDetail(parsed.error);
    }
    if (typeof parsed.detail === "string" && parsed.detail.trim()) {
      return clipDetail(parsed.detail);
    }
  } catch {
    //
  }

  return clipDetail(text.replace(/\s+/g, " ").trim());
}

function isGenericMessage(value: string): boolean {
  const text = value.toLowerCase();
  return (
    text === "fetch failed" ||
    text === "unknown stream error" ||
    text === "unknown error" ||
    text === "failed to fetch"
  );
}

function clipDetail(value: string): string {
  if (value.length <= 220) {
    return value;
  }
  return `${value.slice(0, 217)}...`;
}

function cleanValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function readProperty(value: unknown, key: string): string | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  return cleanValue((value as Record<string, unknown>)[key]);
}

function readNumberProperty(value: unknown, key: string): number | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const candidate = (value as Record<string, unknown>)[key];
  return typeof candidate === "number" && Number.isFinite(candidate) ? candidate : undefined;
}
