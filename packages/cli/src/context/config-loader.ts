import { access, mkdir, readFile } from "node:fs/promises";
import { constants } from "node:fs";
import os from "node:os";
import path from "node:path";
import type {
  ApprovalMode,
  ResolvedXpertCliConfig,
  SandboxMode,
  XpertCliProjectConfig,
  XpertCliUserConfig,
} from "@xpert-cli/contracts";
import { loadXpertMd } from "./xpert-md.js";

export async function loadResolvedConfig(input: {
  projectRoot: string;
  cwd: string;
}): Promise<ResolvedXpertCliConfig> {
  const userConfigDir = path.join(os.homedir(), ".xpert-cli");
  const userConfigPath = path.join(userConfigDir, "config.json");
  const projectConfigPath = path.join(input.projectRoot, ".xpert-cli.json");
  const dotEnvPath = path.join(input.projectRoot, ".env");
  const dotEnvLocalPath = path.join(input.projectRoot, ".env.local");

  await mkdir(userConfigDir, { recursive: true });

  const [userConfig, projectConfig, dotEnvConfig, dotEnvLocalConfig, xpertMd] = await Promise.all([
    readJsonIfExists<XpertCliUserConfig>(userConfigPath),
    readJsonIfExists<XpertCliProjectConfig>(projectConfigPath),
    readDotEnvConfig(dotEnvPath),
    readDotEnvConfig(dotEnvLocalPath),
    loadXpertMd(input.projectRoot),
  ]);

  const merged = mergeDefinedConfigs(
    userConfig,
    projectConfig,
    dotEnvConfig,
    dotEnvLocalConfig,
    readEnvConfig(),
  );

  return {
    apiUrl: normalizeApiUrl(merged.apiUrl ?? "http://localhost:3000/api"),
    apiKey: merged.apiKey,
    assistantId: merged.assistantId,
    defaultModel: merged.defaultModel,
    organizationId: merged.organizationId,
    approvalMode: normalizeApprovalMode(merged.approvalMode),
    sandboxMode: normalizeSandboxMode(merged.sandboxMode),
    projectRoot: input.projectRoot,
    cwd: input.cwd,
    userConfigDir,
    userConfigPath,
    projectConfigPath,
    xpertMdPath: xpertMd.path,
    xpertMdContent: xpertMd.content,
  };
}

function readEnvConfig(): XpertCliUserConfig {
  return {
    apiUrl: process.env.XPERT_API_URL,
    apiKey: process.env.XPERT_API_KEY,
    assistantId: process.env.XPERT_AGENT_ID,
    defaultModel: process.env.XPERT_DEFAULT_MODEL,
    organizationId: process.env.XPERT_ORGANIZATION_ID,
    approvalMode: process.env.XPERT_CLI_APPROVAL_MODE as ApprovalMode | undefined,
    sandboxMode: process.env.XPERT_CLI_SANDBOX_MODE as SandboxMode | undefined,
  };
}

async function readJsonIfExists<T>(filePath: string): Promise<T | undefined> {
  try {
    await access(filePath, constants.R_OK);
    const raw = await readFile(filePath, "utf8");
    return JSON.parse(raw) as T;
  } catch {
    return undefined;
  }
}

async function readDotEnvConfig(filePath: string): Promise<XpertCliUserConfig | undefined> {
  try {
    await access(filePath, constants.R_OK);
    const raw = await readFile(filePath, "utf8");
    const values = parseDotEnv(raw);

    return {
      apiUrl: values.XPERT_API_URL,
      apiKey: values.XPERT_API_KEY,
      assistantId: values.XPERT_AGENT_ID,
      defaultModel: values.XPERT_DEFAULT_MODEL,
      organizationId: values.XPERT_ORGANIZATION_ID,
      approvalMode: values.XPERT_CLI_APPROVAL_MODE as ApprovalMode | undefined,
      sandboxMode: values.XPERT_CLI_SANDBOX_MODE as SandboxMode | undefined,
    };
  } catch {
    return undefined;
  }
}

function parseDotEnv(raw: string): Record<string, string> {
  const result: Record<string, string> = {};

  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const normalized = trimmed.startsWith("export ")
      ? trimmed.slice("export ".length).trim()
      : trimmed;
    const separatorIndex = normalized.indexOf("=");
    if (separatorIndex <= 0) {
      continue;
    }

    const key = normalized.slice(0, separatorIndex).trim();
    let value = normalized.slice(separatorIndex + 1).trim();
    if (!key) {
      continue;
    }

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    result[key] = value;
  }

  return result;
}

function normalizeApiUrl(apiUrl: string): string {
  const normalized = apiUrl.replace(/\/+$/, "");
  if (normalized.endsWith("/api/ai")) {
    return normalized;
  }
  if (normalized.endsWith("/api")) {
    return `${normalized}/ai`;
  }
  if (normalized.endsWith("/ai")) {
    return `${normalized.slice(0, -3)}/api/ai`;
  }
  return `${normalized}/api/ai`;
}

function mergeDefinedConfigs(
  ...configs: Array<XpertCliUserConfig | XpertCliProjectConfig | undefined>
): XpertCliUserConfig {
  const merged: XpertCliUserConfig = {};

  for (const config of configs) {
    if (!config) {
      continue;
    }

    for (const [key, value] of Object.entries(config)) {
      if (value !== undefined) {
        merged[key as keyof XpertCliUserConfig] = value as never;
      }
    }
  }

  return merged;
}

function normalizeApprovalMode(value?: ApprovalMode): ApprovalMode {
  if (value === "auto" || value === "never") {
    return value;
  }
  return "default";
}

function normalizeSandboxMode(value?: SandboxMode): SandboxMode {
  if (value === "docker" || value === "remote-sandbox") {
    return value;
  }
  return "host";
}
