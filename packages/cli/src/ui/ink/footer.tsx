import path from "node:path";
import { Box, Text } from "ink";
import type { ApprovalMode } from "@xpert-cli/contracts";

export function Footer(props: {
  cwd: string;
  git: string;
  sessionId: string;
  approvalMode: ApprovalMode;
  turnState: "idle" | "running" | "waiting";
  notice?: string;
}) {
  const parts = [
    shortPath(props.cwd),
    props.git,
    `session ${props.sessionId.slice(0, 8)}`,
    `approval ${props.approvalMode}`,
    props.turnState,
    ...(props.notice ? [clip(props.notice, 60)] : []),
  ];

  return (
    <Box marginTop={1}>
      <Text dimColor>{parts.join(" | ")}</Text>
    </Box>
  );
}

function shortPath(value: string): string {
  const base = path.basename(value);
  if (base && base !== path.sep) {
    return base;
  }

  return clip(value, 32);
}

function clip(value: string, maxChars: number): string {
  if (value.length <= maxChars) {
    return value;
  }

  return `...${value.slice(-(maxChars - 3))}`;
}
