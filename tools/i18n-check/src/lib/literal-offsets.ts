/**
 * Maps the decoded text of a string or template literal back to source
 * offsets (Batch 3 round-2 review, inline-template escape sequences).
 *
 * `parseTemplate` walks the decoded text (`ts.StringLiteral.text`), while
 * markers and reports use file offsets and lines. An escape sequence decodes
 * to fewer characters than its source (`A` is six characters for one),
 * and a line continuation or a template literal's CRLF decodes to fewer
 * still, so a constant `start + index` drifts after the first escape. Here
 * every decoded UTF-16 unit gets the file offset of the source character or
 * escape sequence that produced it.
 *
 * Decoding follows ECMAScript's string and template value rules: single
 * character escapes, `\xHH`, `\uHHHH`, `\u{H…}`, legacy octal (string
 * literals), line continuations, identity escapes, and CR / CRLF normalised
 * to LF in template literals.
 */

export interface DecodedLiteral {
  /** The decoded text, as the TypeScript scanner reports it. */
  text: string;
  /** File offset per decoded UTF-16 unit, plus one entry for the end. */
  offsets: number[];
}

const SINGLE_ESCAPES: Readonly<Record<string, string>> = {
  b: '\b',
  f: '\f',
  n: '\n',
  r: '\r',
  t: '\t',
  v: '\v',
};

const LINE_TERMINATORS = new Set(['\n', '\u2028', '\u2029']);

/**
 * Decodes `raw`, the source text between a literal's delimiters, which
 * starts at file offset `start`.
 */
export function decodeLiteral(raw: string, start: number): DecodedLiteral {
  let text = '';
  const offsets: number[] = [];
  const emit = (value: string, at: number): void => {
    text += value;
    for (let unit = 0; unit < value.length; unit++) offsets.push(start + at);
  };

  let i = 0;
  while (i < raw.length) {
    const c = raw[i];
    if (c === '\r') {
      emit('\n', i);
      i += raw[i + 1] === '\n' ? 2 : 1;
      continue;
    }
    if (c !== '\\') {
      emit(c, i);
      i += 1;
      continue;
    }

    const next = raw[i + 1];
    if (next === undefined) {
      throw new Error(`unterminated escape at literal offset ${i}`);
    }
    if (next === '\r') {
      // Line continuation: decodes to nothing.
      i += raw[i + 2] === '\n' ? 3 : 2;
    } else if (LINE_TERMINATORS.has(next)) {
      i += 2;
    } else if (next in SINGLE_ESCAPES) {
      emit(SINGLE_ESCAPES[next], i);
      i += 2;
    } else if (next === 'x') {
      emit(String.fromCharCode(hexValue(raw, i + 2, i + 4)), i);
      i += 4;
    } else if (next === 'u' && raw[i + 2] === '{') {
      const close = raw.indexOf('}', i + 3);
      if (close === -1) {
        throw new Error(`unterminated \\u{ escape at literal offset ${i}`);
      }
      emit(String.fromCodePoint(hexValue(raw, i + 3, close)), i);
      i = close + 1;
    } else if (next === 'u') {
      emit(String.fromCharCode(hexValue(raw, i + 2, i + 6)), i);
      i += 6;
    } else if (next >= '0' && next <= '7') {
      const length = octalLength(raw, i + 1);
      emit(
        String.fromCharCode(parseInt(raw.slice(i + 1, i + 1 + length), 8)),
        i,
      );
      i += 1 + length;
    } else {
      // Identity escape (`\\`, `\'`, `\``, `\$`, `\8`, …), whole code point.
      const identity = String.fromCodePoint(raw.codePointAt(i + 1) as number);
      emit(identity, i);
      i += 1 + identity.length;
    }
  }
  offsets.push(start + raw.length);
  return { text, offsets };
}

function hexValue(raw: string, from: number, to: number): number {
  const digits = raw.slice(from, to);
  if (digits === '' || !/^[0-9A-Fa-f]+$/.test(digits)) {
    throw new Error(`invalid hex escape "${digits}" at literal offset ${from}`);
  }
  return parseInt(digits, 16);
}

/** Legacy octal escape length: up to three digits from 0-3, two from 4-7. */
function octalLength(raw: string, from: number): number {
  const max = raw[from] <= '3' ? 3 : 2;
  let length = 1;
  while (
    length < max &&
    raw[from + length] >= '0' &&
    raw[from + length] <= '7'
  ) {
    length += 1;
  }
  return length;
}
