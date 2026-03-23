import prompts from "prompts";
import type { PermissionRequest } from "@xpert-cli/contracts";

export type PermissionPromptResult =
  | { outcome: "allow_once" }
  | { outcome: "allow_session" }
  | { outcome: "deny" }
  | { outcome: "deny_session" };

export interface PermissionPromptChoice {
  title: string;
  outcome: PermissionPromptResult["outcome"];
}

export type PermissionPromptHandler = (
  request: PermissionRequest,
  signal?: AbortSignal,
) => Promise<PermissionPromptResult>;

export async function promptForPermission(
  request: PermissionRequest,
  _signal?: AbortSignal,
): Promise<PermissionPromptResult> {
  const choices = buildPermissionPromptChoices(request);

  const response = await prompts({
    type: "select",
    name: "outcome",
    message: buildPermissionMessage(request),
    choices: choices.map((choice) => ({
      title: choice.title,
      value: choice.outcome,
    })),
    initial: request.riskLevel === "dangerous" ? Math.min(choices.length - 1, 1) : 0,
  });

  return { outcome: response.outcome ?? "deny" };
}

export function buildPermissionPromptChoices(
  request: PermissionRequest,
): PermissionPromptChoice[] {
  return [
    { title: "Allow once", outcome: "allow_once" },
    ...(request.canRememberAllow
      ? [{ title: "Allow for session", outcome: "allow_session" as const }]
      : []),
    {
      title: request.canRememberDeny ? "Deny once" : "Deny",
      outcome: "deny",
    },
    ...(request.canRememberDeny
      ? [{ title: "Deny for session", outcome: "deny_session" as const }]
      : []),
  ];
}

export function buildPermissionMessage(request: PermissionRequest): string {
  const parts = [`${request.toolName} wants to run`];
  if (request.target) {
    parts.push(`on ${request.target}`);
  }
  if (request.reason) {
    parts.push(`(${request.reason})`);
  }
  if (request.scope) {
    parts.push(`[scope: ${request.scope}]`);
  }
  return parts.join(" ");
}
