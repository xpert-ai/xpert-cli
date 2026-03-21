import prompts from "prompts";
import type { PermissionRequest } from "@xpert-cli/contracts";

export type PermissionPromptResult =
  | { outcome: "allow_once" }
  | { outcome: "allow_session" }
  | { outcome: "deny" }
  | { outcome: "deny_session" };

export async function promptForPermission(
  request: PermissionRequest,
): Promise<PermissionPromptResult> {
  const choices = [
    { title: "Allow once", value: "allow_once" as const },
    ...(request.canRememberAllow
      ? [{ title: "Allow for session", value: "allow_session" as const }]
      : []),
    {
      title: request.canRememberDeny ? "Deny once" : "Deny",
      value: "deny" as const,
    },
    ...(request.canRememberDeny
      ? [{ title: "Deny for session", value: "deny_session" as const }]
      : []),
  ];

  const response = await prompts({
    type: "select",
    name: "outcome",
    message: buildMessage(request),
    choices,
    initial: request.riskLevel === "dangerous" ? Math.min(choices.length - 1, 1) : 0,
  });

  return { outcome: response.outcome ?? "deny" };
}

function buildMessage(request: PermissionRequest): string {
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
