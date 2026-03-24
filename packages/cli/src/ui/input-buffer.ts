export interface InputBufferController {
  append(chunk: string): string;
  backspace(): string;
  clear(): string;
  setValue(next: string): string;
  getValue(): string;
  takeTrimmedValue(): string;
}

export interface InputChunkResult {
  text: string;
  submit: boolean;
}

export function createInputBufferController(
  onChange: (value: string) => void,
): InputBufferController {
  let value = "";

  const sync = (next: string): string => {
    value = next;
    onChange(next);
    return next;
  };

  return {
    append(chunk) {
      return sync(value + chunk);
    },
    backspace() {
      return sync(value.slice(0, -1));
    },
    clear() {
      return sync("");
    },
    setValue(next) {
      return sync(next);
    },
    getValue() {
      return value;
    },
    takeTrimmedValue() {
      const trimmed = value.trim();
      sync("");
      return trimmed;
    },
  };
}

export function parseInputChunk(value: string): InputChunkResult {
  const normalized = value.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const submit = /\n+$/.test(normalized);

  return {
    text: submit ? normalized.replace(/\n+$/, "") : normalized,
    submit,
  };
}
