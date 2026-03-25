const ANSI_PATTERN =
  // Covers the ANSI escape sequences we might encounter in terminal-oriented strings.
  /[\u001B\u009B][[\]()#;?]*(?:(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><~]|(?:[a-zA-Z\d]*(?:;[a-zA-Z\d]*)*)?\u0007)/g;
const COMBINING_MARK_PATTERN = /\p{Mark}/u;
const EMOJI_PATTERN = /\p{Extended_Pictographic}/u;

export function stripAnsi(value: string): string {
  return value.replace(ANSI_PATTERN, "");
}

export function stringDisplayWidth(value: string): number {
  let width = 0;
  for (const char of stripAnsi(value)) {
    width += charDisplayWidth(char);
  }
  return width;
}

export function truncateDisplayWidth(
  value: string,
  maxWidth: number,
  options?: {
    ellipsis?: string;
    position?: "end" | "start";
  },
): string {
  const input = stripAnsi(value);
  if (maxWidth <= 0) {
    return "";
  }
  if (stringDisplayWidth(input) <= maxWidth) {
    return input;
  }

  const ellipsis = options?.ellipsis ?? "…";
  const ellipsisWidth = stringDisplayWidth(ellipsis);
  if (ellipsisWidth >= maxWidth) {
    return takeHeadDisplayWidth(ellipsis, maxWidth);
  }

  const availableWidth = maxWidth - ellipsisWidth;
  if (options?.position === "start") {
    return `${ellipsis}${takeTailDisplayWidth(input, availableWidth)}`;
  }

  return `${takeHeadDisplayWidth(input, availableWidth)}${ellipsis}`;
}

export function wrapDisplayWidth(value: string, maxWidth: number): string[] {
  const input = stripAnsi(value);
  const width = Math.max(1, maxWidth);
  const lines: string[] = [];
  let remaining = input;

  while (remaining.length > 0) {
    const { segment, consumedLength } = takeHeadDisplayWidthChunk(
      remaining,
      width,
    );
    if (consumedLength <= 0) {
      break;
    }
    lines.push(segment);
    remaining = remaining.slice(consumedLength);
  }

  return lines;
}

export function takeHeadDisplayWidthChunk(
  value: string,
  maxWidth: number,
  options?: {
    ellipsis?: string;
  },
): {
  segment: string;
  consumedLength: number;
} {
  const input = stripAnsi(value);
  if (maxWidth <= 0 || input.length === 0) {
    return {
      segment: "",
      consumedLength: 0,
    };
  }

  let segment = "";
  let width = 0;
  let consumedLength = 0;

  for (const char of input) {
    const nextWidth = charDisplayWidth(char);
    if (segment.length > 0 && width + nextWidth > maxWidth) {
      break;
    }

    if (segment.length === 0 && nextWidth > maxWidth) {
      return {
        segment: truncateDisplayWidth(char, maxWidth, options),
        consumedLength: char.length,
      };
    }

    segment += char;
    width += nextWidth;
    consumedLength += char.length;
  }

  return {
    segment,
    consumedLength,
  };
}

function takeHeadDisplayWidth(value: string, maxWidth: number): string {
  if (maxWidth <= 0) {
    return "";
  }

  let result = "";
  let width = 0;
  for (const char of value) {
    const nextWidth = charDisplayWidth(char);
    if (result.length > 0 && width + nextWidth > maxWidth) {
      break;
    }
    if (result.length === 0 && nextWidth > maxWidth) {
      return "";
    }
    result += char;
    width += nextWidth;
  }

  return result;
}

function takeTailDisplayWidth(value: string, maxWidth: number): string {
  if (maxWidth <= 0) {
    return "";
  }

  const chars = [...value];
  const tail: string[] = [];
  let width = 0;

  for (let index = chars.length - 1; index >= 0; index -= 1) {
    const char = chars[index];
    if (!char) {
      continue;
    }

    const nextWidth = charDisplayWidth(char);
    if (tail.length > 0 && width + nextWidth > maxWidth) {
      break;
    }
    if (tail.length === 0 && nextWidth > maxWidth) {
      return "";
    }
    tail.unshift(char);
    width += nextWidth;
  }

  return tail.join("");
}

function charDisplayWidth(char: string): number {
  const codePoint = char.codePointAt(0);
  if (!codePoint) {
    return 0;
  }

  if (
    codePoint === 0 ||
    codePoint === 0x200c ||
    codePoint === 0x200d ||
    codePoint === 0xfe0e ||
    codePoint === 0xfe0f ||
    codePoint < 0x20 ||
    (codePoint >= 0x7f && codePoint < 0xa0) ||
    COMBINING_MARK_PATTERN.test(char)
  ) {
    return 0;
  }

  if (EMOJI_PATTERN.test(char) || isFullWidthCodePoint(codePoint)) {
    return 2;
  }

  return 1;
}

// Adapted from the widely used full-width code point heuristic in string-width/is-fullwidth-code-point.
function isFullWidthCodePoint(codePoint: number): boolean {
  if (codePoint >= 0x1100 && (
    codePoint <= 0x115f ||
    codePoint === 0x2329 ||
    codePoint === 0x232a ||
    (codePoint >= 0x2e80 && codePoint <= 0x3247 && codePoint !== 0x303f) ||
    (codePoint >= 0x3250 && codePoint <= 0x4dbf) ||
    (codePoint >= 0x4e00 && codePoint <= 0xa4c6) ||
    (codePoint >= 0xa960 && codePoint <= 0xa97c) ||
    (codePoint >= 0xac00 && codePoint <= 0xd7a3) ||
    (codePoint >= 0xf900 && codePoint <= 0xfaff) ||
    (codePoint >= 0xfe10 && codePoint <= 0xfe19) ||
    (codePoint >= 0xfe30 && codePoint <= 0xfe6b) ||
    (codePoint >= 0xff01 && codePoint <= 0xff60) ||
    (codePoint >= 0xffe0 && codePoint <= 0xffe6) ||
    (codePoint >= 0x1aff0 && codePoint <= 0x1aff3) ||
    (codePoint >= 0x1aff5 && codePoint <= 0x1affb) ||
    (codePoint >= 0x1affd && codePoint <= 0x1affe) ||
    (codePoint >= 0x1b000 && codePoint <= 0x1b122) ||
    (codePoint >= 0x1b132 && codePoint <= 0x1b132) ||
    (codePoint >= 0x1b150 && codePoint <= 0x1b152) ||
    (codePoint >= 0x1b155 && codePoint <= 0x1b155) ||
    (codePoint >= 0x1b164 && codePoint <= 0x1b167) ||
    (codePoint >= 0x1b170 && codePoint <= 0x1b2fb) ||
    (codePoint >= 0x1f200 && codePoint <= 0x1f202) ||
    (codePoint >= 0x1f210 && codePoint <= 0x1f23b) ||
    (codePoint >= 0x1f240 && codePoint <= 0x1f248) ||
    (codePoint >= 0x1f250 && codePoint <= 0x1f251) ||
    (codePoint >= 0x20000 && codePoint <= 0x3fffd)
  )) {
    return true;
  }

  return false;
}
