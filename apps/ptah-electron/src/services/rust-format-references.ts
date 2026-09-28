/**
 * References to a name inside a Rust string used as a format string
 * (Batch 30 r1 R30-03, Batch 31 r1 R31-04).
 *
 * `format!("{needle}")` captures the variable `needle`, and
 * `{0:needle$}` / `{:.needle$}` use it as a width or precision. The grammar
 * does not parse format strings, and a raw-text word match cannot read them
 * either: `"\x7bneedle\x7d"` spells `{needle}` through escapes (the raw text
 * has no brace, and `b` glues to the name), while `"{{needle}}"` is literal
 * braces around literal text, not a capture.
 *
 * So the literal is decoded with Rust's escape rules (`\n \r \t \\ \0 \' \"`,
 * `\xNN`, `\u{…}`, and a line continuation that skips the newline and the
 * following whitespace), keeping each decoded character's offset in the
 * literal, and the decoded text is read with the format rules: `{{` and
 * `}}` are literal braces; `{arg[:spec]}` names `arg`, and `name$` in the
 * spec names a width or precision argument. Each use of the identifier is
 * mapped back to its row and column in the file.
 *
 * Any non-byte string can be a format string (the macro that receives it is
 * not checked), so a non-format string holding `{needle}` still counts: the
 * text-scan approximation, erring towards a kept reference.
 */

/** A 0-based position in the file. */
export interface SourcePosition {
  readonly line: number;
  readonly column: number;
}

const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;
const WIDTH_ARGUMENT = /([A-Za-z_][A-Za-z0-9_]*)\$/g;
const SIMPLE_ESCAPES: Readonly<Record<string, string>> = {
  n: '\n',
  r: '\r',
  t: '\t',
  '\\': '\\',
  '0': '\0',
  "'": "'",
  '"': '"',
};

interface Decoded {
  /** The decoded characters. */
  readonly chars: string[];
  /** For each decoded character, its offset in the literal's text. */
  readonly origins: number[];
}

/** The content of a Rust string literal, decoded, or `null` for a byte or C string. */
function decodeLiteral(literal: string): Decoded | null {
  const raw = /^r(#*)"/.exec(literal);
  if (raw !== null) {
    const start = raw[0].length;
    const end = literal.length - 1 - raw[1].length;
    const chars: string[] = [];
    const origins: number[] = [];
    for (let i = start; i < end; i++) {
      chars.push(literal[i]);
      origins.push(i);
    }
    return { chars, origins };
  }
  if (!literal.startsWith('"')) return null;
  const end = literal.length - 1;
  const chars: string[] = [];
  const origins: number[] = [];
  let i = 1;
  while (i < end) {
    const c = literal[i];
    if (c !== '\\' || i + 1 >= end) {
      chars.push(c);
      origins.push(i);
      i++;
      continue;
    }
    const next = literal[i + 1];
    if (next === '\n' || next === '\r') {
      // Line continuation: the newline and the whitespace after it vanish.
      i += 2;
      while (i < end && /\s/.test(literal[i])) i++;
      continue;
    }
    if (Object.hasOwn(SIMPLE_ESCAPES, next)) {
      chars.push(SIMPLE_ESCAPES[next]);
      origins.push(i);
      i += 2;
      continue;
    }
    const hex =
      next === 'x' ? /^[0-9a-fA-F]{2}/.exec(literal.slice(i + 2)) : null;
    if (hex !== null) {
      chars.push(String.fromCharCode(parseInt(hex[0], 16)));
      origins.push(i);
      i += 2 + hex[0].length;
      continue;
    }
    const unicode =
      next === 'u'
        ? /^\{([0-9a-fA-F_]{1,8})\}/.exec(literal.slice(i + 2))
        : null;
    if (unicode !== null) {
      const code = parseInt(unicode[1].replace(/_/g, ''), 16);
      chars.push(
        Number.isFinite(code) && code <= 0x10ffff
          ? String.fromCodePoint(code)
          : '�',
      );
      origins.push(i);
      i += 2 + unicode[0].length;
      continue;
    }
    // Not a valid escape (the file would not compile): kept as written.
    chars.push(c);
    origins.push(i);
    i++;
  }
  return { chars, origins };
}

/** Offsets (in the literal) where `identifier` is used as a format argument. */
function formatArgumentOffsets(decoded: Decoded, identifier: string): number[] {
  const { chars, origins } = decoded;
  const found: number[] = [];
  let i = 0;
  while (i < chars.length) {
    const c = chars[i];
    if (c === '}') {
      i += chars[i + 1] === '}' ? 2 : 1;
      continue;
    }
    if (c !== '{') {
      i++;
      continue;
    }
    if (chars[i + 1] === '{') {
      i += 2;
      continue;
    }
    const close = chars.indexOf('}', i + 1);
    if (close < 0) break;
    const inner = chars.slice(i + 1, close).join('');
    const colon = inner.indexOf(':');
    const argument = colon < 0 ? inner : inner.slice(0, colon);
    if (IDENTIFIER.test(argument) && argument === identifier) {
      found.push(origins[i + 1]);
    }
    if (colon >= 0) {
      const spec = inner.slice(colon + 1);
      for (const match of spec.matchAll(WIDTH_ARGUMENT)) {
        if (match[1] === identifier && match.index !== undefined) {
          found.push(origins[i + 1 + colon + 1 + match.index]);
        }
      }
    }
    i = close + 1;
  }
  return found;
}

/** The file position of `offset` in a literal that starts at `start`. */
function positionOf(
  literal: string,
  start: SourcePosition,
  offset: number,
): SourcePosition {
  let line = start.line;
  let column = start.column;
  for (let i = 0; i < offset; i++) {
    if (literal[i] === '\n') {
      line++;
      column = 0;
    } else {
      column++;
    }
  }
  return { line, column };
}

/**
 * Where `identifier` is used as a format argument inside the Rust string
 * literal `literal` (its full text, prefix and quotes included) that starts
 * at `start`. Byte strings and C strings name no argument.
 */
export function rustFormatReferences(
  literal: string,
  start: SourcePosition,
  identifier: string,
): SourcePosition[] {
  const decoded = decodeLiteral(literal);
  if (decoded === null) return [];
  return formatArgumentOffsets(decoded, identifier).map((offset) =>
    positionOf(literal, start, offset),
  );
}
