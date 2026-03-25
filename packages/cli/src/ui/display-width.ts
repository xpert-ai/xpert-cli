const ANSI_PATTERN =
  // Covers the ANSI escape sequences we might encounter in terminal-oriented strings.
  /[\u001B\u009B][[\]()#;?]*(?:(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><~]|(?:[a-zA-Z\d]*(?:;[a-zA-Z\d]*)*)?\u0007)/g;
const ZERO_WIDTH_CODE_POINT_PATTERN =
  /[\p{Control}\p{Mark}\p{Default_Ignorable_Code_Point}]/u;
const EMOJI_PRESENTATION_PATTERN = /\p{Emoji_Presentation}/u;
const REGIONAL_INDICATOR_PATTERN = /\p{Regional_Indicator}/u;
const EXTENDED_PICTOGRAPHIC_PATTERN = /\p{Extended_Pictographic}/u;
const EMOJI_VARIATION_SELECTOR = "\uFE0F";
const ZERO_WIDTH_JOINER = "\u200D";
const KEYCAP_MARK = "\u20E3";

interface DisplayUnit {
  text: string;
  width: number;
}

interface SegmentEntryLike {
  segment: string;
}

interface GraphemeSegmenterLike {
  segment(input: string): Iterable<SegmentEntryLike>;
}

const IntlWithSegmenter = Intl as typeof Intl & {
  Segmenter?: new (
    locales?: string | string[],
    options?: {
      granularity: "grapheme";
    },
  ) => GraphemeSegmenterLike;
};

const GRAPHEME_SEGMENTER = IntlWithSegmenter.Segmenter
  ? new IntlWithSegmenter.Segmenter(undefined, {
      granularity: "grapheme",
    })
  : undefined;

export function stripAnsi(value: string): string {
  return value.replace(ANSI_PATTERN, "");
}

export function stringDisplayWidth(value: string): number {
  return segmentDisplayUnits(value).reduce(
    (width, unit) => width + unit.width,
    0,
  );
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
  const units = segmentDisplayUnits(input);
  if (displayUnitsWidth(units) <= maxWidth) {
    return input;
  }

  const ellipsis = stripAnsi(options?.ellipsis ?? "…");
  const ellipsisUnits = segmentDisplayUnits(ellipsis);
  const ellipsisWidth = displayUnitsWidth(ellipsisUnits);
  if (ellipsisWidth >= maxWidth) {
    return takeHeadDisplayWidthUnits(ellipsisUnits, maxWidth);
  }

  const availableWidth = maxWidth - ellipsisWidth;
  if (options?.position === "start") {
    return `${ellipsis}${takeTailDisplayWidthUnits(units, availableWidth)}`;
  }

  return `${takeHeadDisplayWidthUnits(units, availableWidth)}${ellipsis}`;
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

  const units = segmentDisplayUnits(input);
  let segment = "";
  let width = 0;
  let consumedLength = 0;
  let firstUnit: DisplayUnit | undefined;

  for (const unit of units) {
    firstUnit ??= unit;
    if (unit.width === 0) {
      segment += unit.text;
      consumedLength += unit.text.length;
      continue;
    }

    if (width > 0 && width + unit.width > maxWidth) {
      break;
    }

    if (width === 0 && unit.width > maxWidth) {
      return {
        segment: truncateDisplayWidth(unit.text, maxWidth, options),
        consumedLength: unit.text.length,
      };
    }

    segment += unit.text;
    width += unit.width;
    consumedLength += unit.text.length;
  }

  if (segment.length === 0 && firstUnit) {
    return {
      segment: truncateDisplayWidth(firstUnit.text, maxWidth, options),
      consumedLength: firstUnit.text.length,
    };
  }

  return {
    segment,
    consumedLength,
  };
}

function takeHeadDisplayWidthUnits(units: DisplayUnit[], maxWidth: number): string {
  if (maxWidth <= 0) {
    return "";
  }

  let result = "";
  let width = 0;
  for (const unit of units) {
    if (unit.width === 0) {
      result += unit.text;
      continue;
    }

    if (width > 0 && width + unit.width > maxWidth) {
      break;
    }

    if (width === 0 && unit.width > maxWidth) {
      return "";
    }

    result += unit.text;
    width += unit.width;
  }

  return result;
}

function takeTailDisplayWidthUnits(units: DisplayUnit[], maxWidth: number): string {
  if (maxWidth <= 0) {
    return "";
  }

  const tail: string[] = [];
  let width = 0;

  for (let index = units.length - 1; index >= 0; index -= 1) {
    const unit = units[index];
    if (!unit) {
      continue;
    }

    if (unit.width === 0) {
      tail.unshift(unit.text);
      continue;
    }

    if (width > 0 && width + unit.width > maxWidth) {
      break;
    }

    if (width === 0 && unit.width > maxWidth) {
      return "";
    }

    tail.unshift(unit.text);
    width += unit.width;
  }

  return tail.join("");
}

function segmentDisplayUnits(value: string): DisplayUnit[] {
  return segmentGraphemes(stripAnsi(value)).map((segment) => ({
    text: segment,
    width: graphemeDisplayWidth(segment),
  }));
}

function displayUnitsWidth(units: DisplayUnit[]): number {
  return units.reduce((width, unit) => width + unit.width, 0);
}

function segmentGraphemes(value: string): string[] {
  if (!value) {
    return [];
  }

  if (!GRAPHEME_SEGMENTER) {
    return [...value];
  }

  return Array.from(
    GRAPHEME_SEGMENTER.segment(value),
    (entry) => entry.segment,
  );
}

function graphemeDisplayWidth(grapheme: string): number {
  let hasVisibleCodePoint = false;
  let hasFullWidthCodePoint = false;

  for (const codePointText of [...grapheme]) {
    if (ZERO_WIDTH_CODE_POINT_PATTERN.test(codePointText)) {
      continue;
    }

    hasVisibleCodePoint = true;

    const codePoint = codePointText.codePointAt(0);
    if (codePoint && isFullWidthCodePoint(codePoint)) {
      hasFullWidthCodePoint = true;
    }
  }

  if (!hasVisibleCodePoint) {
    return 0;
  }

  if (isEmojiLikeGrapheme(grapheme) || hasFullWidthCodePoint) {
    return 2;
  }

  return 1;
}

function isEmojiLikeGrapheme(grapheme: string): boolean {
  return (
    EMOJI_PRESENTATION_PATTERN.test(grapheme) ||
    REGIONAL_INDICATOR_PATTERN.test(grapheme) ||
    grapheme.includes(EMOJI_VARIATION_SELECTOR) ||
    grapheme.includes(KEYCAP_MARK) ||
    (grapheme.includes(ZERO_WIDTH_JOINER) &&
      EXTENDED_PICTOGRAPHIC_PATTERN.test(grapheme))
  );
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
