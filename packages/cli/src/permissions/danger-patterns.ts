const DANGEROUS_COMMAND_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /\brm\s+-rf\s+\/($|\s)/, reason: "destructive root delete" },
  { pattern: /\brm\s+-rf\s+~($|\s)/, reason: "destructive home delete" },
  { pattern: /\bsudo\b/, reason: "privilege escalation" },
  { pattern: /\bmkfs\b/, reason: "filesystem formatting" },
  { pattern: /\bdd\s+if=/, reason: "disk overwrite command" },
  { pattern: /\bgit\s+reset\s+--hard\b/, reason: "destructive git reset" },
  { pattern: /\bgit\s+clean\s+-fd\b/, reason: "destructive git clean" },
  { pattern: /\bgit\s+push\s+--force\b/, reason: "force push" },
];

export function detectDangerousCommand(command: string): string | null {
  for (const candidate of DANGEROUS_COMMAND_PATTERNS) {
    if (candidate.pattern.test(command)) {
      return candidate.reason;
    }
  }

  return null;
}
