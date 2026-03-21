export type ApprovalMode = "default" | "auto" | "never";
export type SandboxMode = "host" | "docker" | "remote-sandbox";

export interface XpertCliUserConfig {
  apiUrl?: string;
  apiKey?: string;
  assistantId?: string;
  defaultModel?: string;
  organizationId?: string;
  approvalMode?: ApprovalMode;
  sandboxMode?: SandboxMode;
}

export interface XpertCliProjectConfig extends XpertCliUserConfig {
  cwd?: string;
}

export interface ResolvedXpertCliConfig extends XpertCliUserConfig {
  apiUrl: string;
  apiKey?: string;
  assistantId?: string;
  approvalMode: ApprovalMode;
  sandboxMode: SandboxMode;
  projectRoot: string;
  cwd: string;
  userConfigDir: string;
  userConfigPath: string;
  projectConfigPath: string;
  xpertMdPath?: string;
  xpertMdContent?: string;
}
