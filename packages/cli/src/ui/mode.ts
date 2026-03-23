export type CliExecutionMode =
  | "single_prompt"
  | "interactive_ink"
  | "interactive_text";

export function resolveCliExecutionMode(input: {
  prompt?: string;
  stdinIsTTY?: boolean;
  stdoutIsTTY?: boolean;
}): CliExecutionMode {
  if (input.prompt) {
    return "single_prompt";
  }

  return input.stdinIsTTY && input.stdoutIsTTY
    ? "interactive_ink"
    : "interactive_text";
}
