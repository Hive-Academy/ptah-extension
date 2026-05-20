/**
 * Comment and String Literal Stripper
 *
 * Replaces the contents of comments and string literals in TypeScript source
 * with innocuous filler (spaces) while preserving line breaks, total length,
 * and per-line column positions. This lets regex-based quality rules run
 * against the stripped content without mis-firing on matches inside comments
 * or strings, while reported line/column offsets still map correctly back to
 * the original source.
 *
 * @packageDocumentation
 */

/**
 * Replaces comment and string-literal content in TypeScript source with spaces.
 *
 * Invariants:
 * - Returned string has identical length to `source`.
 * - Every `\n`, `\r`, and `\t` in the input is preserved at the same offset in
 *   the output. All other characters inside stripped regions become a single
 *   space (`' '`) per character.
 * - Template-literal `${...}` expressions remain **unchanged** — only the
 *   static text between `${}` placeholders is replaced. This preserves code
 *   that regex rules should still scan (e.g. `${user as any}` inside a
 *   template string).
 * - Never throws and never hangs on malformed input (unterminated strings or
 *   block comments at EOF simply consume to EOF).
 *
 * Regex-vs-division heuristic:
 * - A `/` is treated as a regex-literal delimiter when the previous
 *   non-whitespace character is one of `(,=:;!&|?+{}[]~^<>%*` or `/`, or when
 *   `/` occurs at start-of-input, or when the previous token is a keyword
 *   like `return`, `typeof`, `in`, `of`, `instanceof`, `new`, `throw`,
 *   `delete`, `void`, `yield`, `await`, `case`.
 * - Otherwise (`/` follows an identifier, number, closing `)` or `]`) it is
 *   treated as division and left alone.
 * - Tradeoff: this heuristic is not perfect — e.g. `a\n/foo/` after a bare
 *   identifier `a` on its own line will be treated as division. This is the
 *   known-hard ambiguity of TS/JS syntax that can only be fully resolved with
 *   a real parser; the heuristic is intentionally simple (under 200 lines,
 *   no deps) and covers the >99% case of quality-rule false-positives.
 *
 * @param source Original TypeScript source text.
 * @returns Stripped text of identical length to `source`.
 */
export function stripCommentsAndStrings(source: string): string {
  const len = source.length;
  const out: string[] = new Array<string>(len);
  for (let i = 0; i < len; i++) {
    out[i] = source[i];
  }

  const KEYWORDS_BEFORE_REGEX = new Set([
    'return',
    'typeof',
    'in',
    'of',
    'instanceof',
    'new',
    'throw',
    'delete',
    'void',
    'yield',
    'await',
    'case',
    'do',
    'else',
  ]);

  /** Replace `source[i]` in `out` with a space, preserving newlines/tabs. */
  const blank = (i: number): void => {
    const ch = source[i];
    if (ch === '\n' || ch === '\r' || ch === '\t') {
      out[i] = ch;
    } else {
      out[i] = ' ';
    }
  };

  /**
   * Determine whether a `/` at position `slashPos` should be treated as the
   * start of a regex literal (true) or division (false). Uses the previous
   * non-whitespace character and, when that is an identifier char, the
   * identifier itself (to detect keyword prefixes like `return /foo/`).
   */
  const isRegexContext = (slashPos: number): boolean => {
    let k = slashPos - 1;
    while (k >= 0) {
      const c = source[k];
      if (c === ' ' || c === '\t' || c === '\r' || c === '\n') {
        k--;
        continue;
      }
      break;
    }
    if (k < 0) return true; // start of input

    const prev = source[k];
    if ('(,=:;!&|?+{}[~^<>%*-/'.includes(prev)) {
      return true;
    }
    if (/[A-Za-z_$0-9]/.test(prev)) {
      const wEnd = k + 1;
      let wStart = k;
      while (wStart > 0 && /[A-Za-z_$0-9]/.test(source[wStart - 1])) {
        wStart--;
      }
      const word = source.substring(wStart, wEnd);
      if (KEYWORDS_BEFORE_REGEX.has(word)) return true;
      return false; // identifier / number → division
    }
    if (prev === ')' || prev === ']') return false;
    return true;
  };

  let i = 0;
  while (i < len) {
    const ch = source[i];
    const next = i + 1 < len ? source[i + 1] : '';
    if (ch === '/' && next === '/') {
      i += 2;
      while (i < len && source[i] !== '\n') {
        blank(i);
        i++;
      }
      continue;
    }
    if (ch === '/' && next === '*') {
      i += 2;
      while (i < len) {
        if (source[i] === '*' && i + 1 < len && source[i + 1] === '/') {
          i += 2;
          break;
        }
        blank(i);
        i++;
      }
      continue;
    }
    if (ch === "'") {
      i++; // keep opening quote
      while (i < len) {
        const c = source[i];
        if (c === '\\' && i + 1 < len) {
          blank(i);
          blank(i + 1);
          i += 2;
          continue;
        }
        if (c === "'" || c === '\n') break; // unterminated ends at newline/EOF
        blank(i);
        i++;
      }
      if (i < len && source[i] === "'") i++; // consume closing quote
      continue;
    }
    if (ch === '"') {
      i++;
      while (i < len) {
        const c = source[i];
        if (c === '\\' && i + 1 < len) {
          blank(i);
          blank(i + 1);
          i += 2;
          continue;
        }
        if (c === '"' || c === '\n') break;
        blank(i);
        i++;
      }
      if (i < len && source[i] === '"') i++;
      continue;
    }
    if (ch === '`') {
      i++;
      let depth = 0; // brace depth inside a ${...} expression
      let inExpr = false;
      while (i < len) {
        const c = source[i];
        if (!inExpr) {
          if (c === '\\' && i + 1 < len) {
            blank(i);
            blank(i + 1);
            i += 2;
            continue;
          }
          if (c === '`') break;
          if (c === '$' && i + 1 < len && source[i + 1] === '{') {
            inExpr = true;
            depth = 1;
            i += 2;
            continue;
          }
          blank(i);
          i++;
        } else {
          if (c === '{') depth++;
          else if (c === '}') {
            depth--;
            if (depth === 0) {
              inExpr = false;
              i++;
              continue;
            }
          }
          i++;
        }
      }
      if (i < len && source[i] === '`') i++;
      continue;
    }
    if (ch === '/' && isRegexContext(i)) {
      i++; // keep opening /
      let inClass = false;
      while (i < len) {
        const c = source[i];
        if (c === '\\' && i + 1 < len) {
          blank(i);
          blank(i + 1);
          i += 2;
          continue;
        }
        if (c === '\n') break; // unterminated
        if (c === '[') inClass = true;
        else if (c === ']') inClass = false;
        else if (c === '/' && !inClass) break;
        blank(i);
        i++;
      }
      if (i < len && source[i] === '/') i++; // consume closing /
      while (i < len && /[a-z]/i.test(source[i])) i++;
      continue;
    }

    i++;
  }

  return out.join('');
}
