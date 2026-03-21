import { createPatch } from "diff";

export function createUnifiedDiff(
  filePath: string,
  before: string,
  after: string,
): string {
  return createPatch(filePath, before, after, "before", "after");
}

export function summarizeDiff(diffText: string): string {
  const lines = diffText.split("\n");
  let added = 0;
  let removed = 0;

  for (const line of lines) {
    if (line.startsWith("+++ ") || line.startsWith("--- ")) {
      continue;
    }
    if (line.startsWith("+")) {
      added += 1;
    }
    if (line.startsWith("-")) {
      removed += 1;
    }
  }

  return `+${added} -${removed}`;
}
