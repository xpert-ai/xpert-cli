import prompts from "prompts";
import type { PermissionRequest } from "@xpert-cli/contracts";

export type PermissionPromptResult =
  | { outcome: "allow_once" }
  | { outcome: "allow_session" }
  | { outcome: "deny" };

export async function promptForPermission(
  request: PermissionRequest,
): Promise<PermissionPromptResult> {
  const response = await prompts({
    type: "select",
    name: "outcome",
    message: buildMessage(request),
    choices: [
      { title: "Allow once", value: "allow_once" },
      ...(request.riskLevel === "moderate"
        ? [{ title: "Allow for session", value: "allow_session" as const }]
        : []),
      { title: "Deny", value: "deny" },
    ],
    initial: request.riskLevel === "dangerous" ? 1 : 0,
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
  return parts.join(" ");
}
