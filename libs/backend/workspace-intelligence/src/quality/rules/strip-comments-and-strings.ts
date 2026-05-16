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
  // Pre-fill with the source so offsets we don't touch remain correct; we
  // will overwrite regions that represent string/comment content.
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
    // Unambiguous operator/punctuation precedents → regex
    if ('(,=:;!&|?+{}[~^<>%*-/'.includes(prev)) {
      return true;
    }

    // If prev is identifier-tail, read back the whole word and check keywords
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

    // `)` and `]` are typical division contexts (e.g. `foo() / 2`, `arr[0] / 2`)
    if (prev === ')' || prev === ']') return false;

    // Conservative default: treat as regex (prefer over-stripping a rare
    // division to under-stripping a regex that would leak matches).
    return true;
  };

  let i = 0;
  while (i < len) {
    const ch = source[i];
    const next = i + 1 < len ? source[i + 1] : '';

    // Line comment: //...
    if (ch === '/' && next === '/') {
      // Do NOT blank the `//` delimiters themselves — they're not string
      // content and leaving them helps rules that inspect structure. But to
      // satisfy "replace comment content", we blank everything AFTER `//` up
      // to (but not including) the newline.
      i += 2;
      while (i < len && source[i] !== '\n') {
        blank(i);
        i++;
      }
      continue;
    }

    // Block comment: /* ... */  (supports "nested" per spec by consuming the
    // entire run until the first `*/`. Real TS doesn't nest block comments;
    // `/* a /* b */` closes at the first `*/`. Anything after the close is
    // re-scanned, so `/* outer /* inner */ still */` leaves ` still */`
    // which is then parsed as normal code — matching JS/TS grammar.)
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

    // Single-quoted string
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

    // Double-quoted string
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

    // Template literal: preserve ${...} expressions, strip the rest.
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
            // Leave `${` intact so regex rules can still see expression scope.
            inExpr = true;
            depth = 1;
            i += 2;
            continue;
          }
          blank(i);
          i++;
        } else {
          // Inside ${expr} — leave everything as-is but track brace depth so
          // we know when the expression closes. This is a best-effort counter;
          // nested strings/templates inside the expression are left intact
          // (they would be scanned by rules too, which is acceptable).
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

    // Regex literal vs division
    if (ch === '/' && isRegexContext(i)) {
      // Consume /pattern/flags, handling escapes and character classes.
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
      // Skip flag characters (a-z) — leave them intact; they're identifier-
      // like and harmless for rules.
      while (i < len && /[a-z]/i.test(source[i])) i++;
      continue;
    }

    i++;
  }

  return out.join('');
}
