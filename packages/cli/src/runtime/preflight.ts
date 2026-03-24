import type { ResolvedXpertCliConfig } from "@xpert-cli/contracts";
import { XpertSdkClient } from "../sdk/client.js";
import {
  formatCliErrorBody,
  isXpertCliRequestError,
  type XpertCliRequestError,
} from "../sdk/request-errors.js";

export type CliCheckStatus = "pass" | "warn" | "fail";
export type CliPreflightMode = "light" | "doctor";

export interface CliPreflightCheck {
  id:
    | "api_url_config"
    | "api_key_config"
    | "assistant_id_config"
    | "backend"
    | "auth"
    | "assistant"
    | "organization"
    | "thread_create";
  status: CliCheckStatus;
  message: string;
  detail?: string;
  hints: string[];
}

export interface CliPreflightReport {
  mode: CliPreflightMode;
  ok: boolean;
  checks: CliPreflightCheck[];
  summary: {
    pass: number;
    warn: number;
    fail: number;
  };
  metadata: {
    apiUrl: string;
    assistantId?: string;
    organizationId?: string;
    cwd: string;
    projectRoot: string;
  };
}

interface PreflightClient {
  ensureThread(existingThreadId?: string): Promise<string>;
  getAssistant(assistantId?: string): Promise<unknown>;
}

export async function runCliPreflight(
  config: ResolvedXpertCliConfig,
  options?: {
    mode?: CliPreflightMode;
    deps?: {
      createClient?: (config: ResolvedXpertCliConfig) => PreflightClient;
    };
  },
): Promise<CliPreflightReport> {
  const mode = options?.mode ?? "light";
  const checks: CliPreflightCheck[] = [];
  const apiUrlValid = isValidUrl(config.apiUrl);
  const client = options?.deps?.createClient?.(config) ?? new XpertSdkClient(config);

  checks.push(
    apiUrlValid
      ? passCheck("api_url_config", "XPERT_API_URL configured", config.apiUrl)
      : failCheck("api_url_config", "XPERT_API_URL is invalid", config.apiUrl, [
          "check XPERT_API_URL",
        ]),
  );
  checks.push(
    config.apiKey
      ? passCheck("api_key_config", "XPERT_API_KEY configured")
      : failCheck("api_key_config", "XPERT_API_KEY is missing", undefined, [
          "set XPERT_API_KEY",
        ]),
  );
  checks.push(
    config.assistantId
      ? passCheck("assistant_id_config", "XPERT_AGENT_ID configured", config.assistantId)
      : failCheck("assistant_id_config", "XPERT_AGENT_ID is missing", undefined, [
          "set XPERT_AGENT_ID",
        ]),
  );

  if (mode === "doctor") {
    const threadChecks = await runThreadCreateChecks({
      config,
      client,
      apiUrlValid,
    });
    checks.push(...threadChecks);
    checks.push(
      ...(await runAssistantChecks({
        config,
        client,
        apiUrlValid,
        allowRemoteCheck:
          !hasFailedCheck(threadChecks, "backend") && !hasFailedCheck(threadChecks, "auth"),
      })),
    );
  } else {
    checks.push(
      ...(await runLightAssistantChecks({
        config,
        client,
        apiUrlValid,
      })),
    );
  }

  const summary = summarizeChecks(checks);
  return {
    mode,
    ok: summary.fail === 0,
    checks,
    summary,
    metadata: {
      apiUrl: config.apiUrl,
      ...(config.assistantId ? { assistantId: config.assistantId } : {}),
      ...(config.organizationId ? { organizationId: config.organizationId } : {}),
      cwd: config.cwd,
      projectRoot: config.projectRoot,
    },
  };
}

export function assertCliPreflight(report: CliPreflightReport): void {
  if (report.ok) {
    return;
  }

  throw new Error(formatPreflightFailure(report));
}

export function formatPreflightFailure(report: CliPreflightReport): string {
  const failedChecks = report.checks.filter((check) => check.status === "fail");
  const primary = failedChecks[0];
  if (!primary) {
    return "preflight failed";
  }

  const lines = [primary.message];
  if (primary.detail) {
    lines.push(`detail: ${primary.detail}`);
  }

  const hints = [...new Set(failedChecks.flatMap((check) => check.hints))];
  for (const hint of hints) {
    lines.push(`hint: ${hint}`);
  }

  return lines.join("\n");
}

export function renderDoctorReport(report: CliPreflightReport): string {
  const lines = [
    "xpert doctor",
    `apiUrl: ${report.metadata.apiUrl}`,
    `assistantId: ${report.metadata.assistantId ?? "(unconfigured)"}`,
    `organizationId: ${report.metadata.organizationId ?? "(unconfigured)"}`,
    `projectRoot: ${report.metadata.projectRoot}`,
    `cwd: ${report.metadata.cwd}`,
    "",
  ];

  for (const check of report.checks) {
    lines.push(`${formatStatus(check.status)} ${check.message}`);
    if (check.detail) {
      lines.push(`  ${check.detail}`);
    }
    for (const hint of check.hints) {
      lines.push(`  hint: ${hint}`);
    }
  }

  lines.push("");
  lines.push(
    `summary: ${report.summary.pass} passed, ${report.summary.warn} warnings, ${report.summary.fail} failed`,
  );

  return lines.join("\n");
}

export function renderDoctorJson(report: CliPreflightReport): string {
  return JSON.stringify(report, null, 2);
}

async function runThreadCreateChecks(input: {
  config: ResolvedXpertCliConfig;
  client: PreflightClient;
  apiUrlValid: boolean;
}): Promise<CliPreflightCheck[]> {
  const checks: CliPreflightCheck[] = [];

  if (!input.apiUrlValid) {
    return [
      failCheck("backend", "backend check failed", input.config.apiUrl, [
        "check XPERT_API_URL",
      ]),
      warnCheck("auth", "auth check skipped because XPERT_API_URL is invalid"),
      organizationSkippedCheck(input.config.organizationId, "XPERT_API_URL is invalid"),
      failCheck("thread_create", "thread creation check failed", undefined, [
        "check XPERT_API_URL",
      ]),
    ];
  }

  if (!input.config.apiKey) {
    return [
      warnCheck("backend", "backend reachability was not checked because XPERT_API_KEY is missing"),
      failCheck("auth", "auth failed", "XPERT_API_KEY is missing", [
        "set XPERT_API_KEY",
        "run xpert auth status",
      ]),
      organizationSkippedCheck(input.config.organizationId, "XPERT_API_KEY is missing"),
      failCheck("thread_create", "thread creation check failed", "XPERT_API_KEY is missing", [
        "set XPERT_API_KEY",
      ]),
    ];
  }

  try {
    const threadId = await input.client.ensureThread();
    checks.push(passCheck("backend", "backend reachable", input.config.apiUrl));
    checks.push(passCheck("auth", "auth accepted by backend"));
    checks.push(
      input.config.organizationId
        ? passCheck("organization", "organization header accepted", input.config.organizationId)
        : warnCheck("organization", "XPERT_ORGANIZATION_ID is not configured"),
    );
    checks.push(passCheck("thread_create", "thread created successfully", threadId));
    return checks;
  } catch (error) {
    return buildThreadFailureChecks(input.config.organizationId, error);
  }
}

async function runAssistantChecks(input: {
  config: ResolvedXpertCliConfig;
  client: PreflightClient;
  apiUrlValid: boolean;
  allowRemoteCheck: boolean;
}): Promise<CliPreflightCheck[]> {
  if (!input.config.assistantId) {
    return [
      warnCheck("assistant", "assistant lookup skipped because XPERT_AGENT_ID is missing", undefined, [
        "set XPERT_AGENT_ID",
      ]),
    ];
  }

  if (!input.apiUrlValid) {
    return [
      warnCheck("assistant", "assistant lookup skipped because XPERT_API_URL is invalid", undefined, [
        "check XPERT_API_URL",
      ]),
    ];
  }

  if (!input.config.apiKey) {
    return [
      warnCheck("assistant", "assistant lookup skipped because XPERT_API_KEY is missing", undefined, [
        "set XPERT_API_KEY",
      ]),
    ];
  }

  if (!input.allowRemoteCheck) {
    return [
      warnCheck("assistant", "assistant lookup skipped until backend/auth checks pass"),
    ];
  }

  try {
    await input.client.getAssistant(input.config.assistantId);
    return [passCheck("assistant", "assistant exists", input.config.assistantId)];
  } catch (error) {
    return [toAssistantFailureCheck(error, input.config.organizationId)];
  }
}

async function runLightAssistantChecks(input: {
  config: ResolvedXpertCliConfig;
  client: PreflightClient;
  apiUrlValid: boolean;
}): Promise<CliPreflightCheck[]> {
  if (!input.apiUrlValid) {
    return [
      failCheck("backend", "cannot reach backend", input.config.apiUrl, [
        "check XPERT_API_URL",
      ]),
      warnCheck("auth", "auth check skipped because XPERT_API_URL is invalid"),
      warnCheck("assistant", "assistant lookup skipped because XPERT_API_URL is invalid"),
    ];
  }

  if (!input.config.apiKey) {
    return [
      warnCheck("backend", "backend reachability was not checked because XPERT_API_KEY is missing"),
      failCheck("auth", "auth failed", "XPERT_API_KEY is missing", [
        "set XPERT_API_KEY",
        "run xpert auth status",
      ]),
      warnCheck("assistant", "assistant lookup skipped because XPERT_API_KEY is missing", undefined, [
        "set XPERT_API_KEY",
      ]),
    ];
  }

  if (!input.config.assistantId) {
    return [
      warnCheck("backend", "backend check skipped until assistant preflight can run"),
      warnCheck("auth", "auth check skipped until XPERT_AGENT_ID is configured"),
      warnCheck("assistant", "assistant lookup skipped because XPERT_AGENT_ID is missing", undefined, [
        "set XPERT_AGENT_ID",
      ]),
    ];
  }

  try {
    await input.client.getAssistant(input.config.assistantId);
    return [
      passCheck("backend", "backend reachable", input.config.apiUrl),
      passCheck("auth", "auth accepted by backend"),
      passCheck("assistant", "assistant exists", input.config.assistantId),
    ];
  } catch (error) {
    return buildLightAssistantFailureChecks(input.config, error);
  }
}

function buildThreadFailureChecks(
  organizationId: string | undefined,
  error: unknown,
): CliPreflightCheck[] {
  if (isRequestErrorKind(error, "service_unavailable")) {
    return [
      failCheck("backend", "cannot reach backend", readDetail(error), [
        "check XPERT_API_URL",
        "start the backend",
      ]),
      warnCheck("auth", "auth check skipped because the backend is unreachable"),
      organizationSkippedCheck(organizationId, "the backend is unreachable"),
      failCheck("thread_create", "thread creation check failed", readDetail(error), [
        "check XPERT_API_URL",
        "start the backend",
      ]),
    ];
  }

  if (isRequestErrorKind(error, "auth_failed")) {
    return [
      passCheck("backend", "backend reachable"),
      failCheck("auth", "auth failed", readDetail(error), [
        "check XPERT_API_KEY",
        "run xpert auth status",
      ]),
      organizationId
        ? failCheck("organization", "organization header rejected or unauthorized", organizationId, [
            "check XPERT_ORGANIZATION_ID and XPERT_API_KEY",
          ])
        : warnCheck("organization", "XPERT_ORGANIZATION_ID is not configured"),
      failCheck("thread_create", "thread creation check failed", readDetail(error), [
        "check XPERT_API_KEY",
      ]),
    ];
  }

  if (isRequestErrorKind(error, "protocol_error")) {
    return [
      passCheck("backend", "backend reachable"),
      warnCheck("auth", "auth was not verified because the backend protocol is incompatible"),
      organizationSkippedCheck(organizationId, "the backend protocol is incompatible"),
      failCheck("thread_create", "thread creation check failed", readDetail(error), [
        "check XPERT_API_URL and backend protocol compatibility",
      ]),
    ];
  }

  return [
    warnCheck("backend", "backend returned an unexpected response", readDetail(error)),
    warnCheck("auth", "auth result was inconclusive", readDetail(error)),
    organizationSkippedCheck(organizationId, "thread creation returned an unexpected response"),
    failCheck("thread_create", "thread creation check failed", readDetail(error), [
      "run xpert doctor",
    ]),
  ];
}

function buildLightAssistantFailureChecks(
  config: ResolvedXpertCliConfig,
  error: unknown,
): CliPreflightCheck[] {
  if (isRequestErrorKind(error, "service_unavailable")) {
    return [
      failCheck("backend", "cannot reach backend", readDetail(error), [
        "check XPERT_API_URL",
        "start the backend",
      ]),
      warnCheck("auth", "auth check skipped because the backend is unreachable"),
      warnCheck("assistant", "assistant lookup skipped because the backend is unreachable"),
    ];
  }

  if (isRequestErrorKind(error, "auth_failed")) {
    return [
      passCheck("backend", "backend reachable", config.apiUrl),
      failCheck("auth", "auth failed", readDetail(error), [
        "check XPERT_API_KEY",
        "run xpert auth status",
      ]),
      warnCheck("assistant", "assistant lookup skipped until auth succeeds"),
    ];
  }

  if (isRequestErrorKind(error, "assistant_not_found")) {
    return [
      passCheck("backend", "backend reachable", config.apiUrl),
      passCheck("auth", "auth accepted by backend"),
      failCheck("assistant", "assistant not found", readDetail(error), [
        "check XPERT_AGENT_ID",
        ...(config.organizationId ? ["check XPERT_ORGANIZATION_ID"] : []),
        "run xpert doctor",
      ]),
    ];
  }

  if (isRequestErrorKind(error, "protocol_error")) {
    return [
      passCheck("backend", "backend reachable", config.apiUrl),
      warnCheck("auth", "auth was not verified because the backend protocol is incompatible"),
      failCheck("assistant", "assistant lookup failed because the backend protocol is incompatible", readDetail(error), [
        "check XPERT_API_URL and backend protocol compatibility",
      ]),
    ];
  }

  return [
    warnCheck("backend", "backend response was inconclusive", readDetail(error)),
    warnCheck("auth", "auth result was inconclusive", readDetail(error)),
    failCheck("assistant", "assistant lookup failed", readDetail(error), [
      "run xpert doctor",
    ]),
  ];
}

function toAssistantFailureCheck(
  error: unknown,
  organizationId?: string,
): CliPreflightCheck {
  if (isRequestErrorKind(error, "assistant_not_found")) {
    return failCheck("assistant", "assistant not found", readDetail(error), [
      "check XPERT_AGENT_ID",
      ...(organizationId ? ["check XPERT_ORGANIZATION_ID"] : []),
      "run xpert doctor",
    ]);
  }

  if (isRequestErrorKind(error, "protocol_error")) {
    return failCheck(
      "assistant",
      "assistant lookup failed because the backend protocol is incompatible",
      readDetail(error),
      ["check XPERT_API_URL and backend protocol compatibility"],
    );
  }

  if (isRequestErrorKind(error, "service_unavailable")) {
    return failCheck("assistant", "cannot reach backend while checking the assistant", readDetail(error), [
      "check XPERT_API_URL",
      "start the backend",
    ]);
  }

  if (isRequestErrorKind(error, "auth_failed")) {
    return failCheck("assistant", "auth failed while checking the assistant", readDetail(error), [
      "check XPERT_API_KEY",
      "run xpert auth status",
    ]);
  }

  return failCheck("assistant", "assistant lookup failed", readDetail(error), [
    "run xpert doctor",
  ]);
}

function hasFailedCheck(checks: CliPreflightCheck[], id: CliPreflightCheck["id"]): boolean {
  return checks.some((check) => check.id === id && check.status === "fail");
}

function summarizeChecks(checks: CliPreflightCheck[]): CliPreflightReport["summary"] {
  return checks.reduce(
    (summary, check) => {
      summary[check.status] += 1;
      return summary;
    },
    { pass: 0, warn: 0, fail: 0 },
  );
}

function passCheck(
  id: CliPreflightCheck["id"],
  message: string,
  detail?: string,
): CliPreflightCheck {
  return {
    id,
    status: "pass",
    message,
    detail,
    hints: [],
  };
}

function warnCheck(
  id: CliPreflightCheck["id"],
  message: string,
  detail?: string,
  hints: string[] = [],
): CliPreflightCheck {
  return {
    id,
    status: "warn",
    message,
    detail,
    hints,
  };
}

function failCheck(
  id: CliPreflightCheck["id"],
  message: string,
  detail?: string,
  hints: string[] = [],
): CliPreflightCheck {
  return {
    id,
    status: "fail",
    message,
    detail,
    hints,
  };
}

function organizationSkippedCheck(
  organizationId: string | undefined,
  reason: string,
): CliPreflightCheck {
  return organizationId
    ? warnCheck("organization", `organization header was not verified because ${reason}`, organizationId)
    : warnCheck("organization", "XPERT_ORGANIZATION_ID is not configured");
}

function readDetail(error: unknown): string | undefined {
  if (isXpertCliRequestError(error)) {
    return error.detail ?? formatCliErrorBody(error);
  }

  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }

  return undefined;
}

function isRequestErrorKind(
  error: unknown,
  kind: XpertCliRequestError["kind"],
): error is XpertCliRequestError {
  return isXpertCliRequestError(error) && error.kind === kind;
}

function isValidUrl(value: string): boolean {
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
}

function formatStatus(status: CliCheckStatus): string {
  switch (status) {
    case "pass":
      return "[pass]";
    case "warn":
      return "[warn]";
    case "fail":
      return "[fail]";
  }
}
