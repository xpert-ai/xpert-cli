export interface UiSink {
  readonly interactive: boolean;
  appendAssistantText(text: string): void;
  showReasoning(text: string): void;
  showToolCall(toolName: string, target?: string): void;
  showToolAck(toolName: string, summary: string): void;
  showBashLine(line: string): void;
  showDiff(diffText: string): void;
  showWarning(message: string): void;
  showError(message: string): void;
  lineBreak(): void;
}
