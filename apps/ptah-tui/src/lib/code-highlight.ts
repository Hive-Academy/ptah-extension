/**
 * A small, dependency-free syntax highlighter for fenced code blocks.
 *
 * Adding `cli-highlight` or `shiki` would drag a grammar bundle (and, for
 * shiki, a WASM regex engine) into a bundle that already ships beside the CLI,
 * to colourise at most a few dozen lines at a time. A terminal transcript needs
 * five token classes to stop looking like a wall of undifferentiated text —
 * comments, strings, numbers, keywords, everything else — and that is what this
 * does. It is deliberately approximate: it is a readability aid, not a parser,
 * and it never throws or reorders characters.
 *
 * Ink-free on purpose so it is unit-testable.
 */

export type CodeTokenKind =
  | 'plain'
  | 'comment'
  | 'string'
  | 'number'
  | 'keyword';

export interface CodeToken {
  readonly kind: CodeTokenKind;
  readonly text: string;
}

type LanguageFamily = 'c-like' | 'python' | 'shell' | 'json' | 'plain';

const C_LIKE_KEYWORDS = new Set([
  'abstract',
  'as',
  'async',
  'await',
  'break',
  'case',
  'catch',
  'class',
  'const',
  'continue',
  'default',
  'delete',
  'do',
  'else',
  'enum',
  'export',
  'extends',
  'false',
  'finally',
  'for',
  'from',
  'function',
  'get',
  'if',
  'implements',
  'import',
  'in',
  'instanceof',
  'interface',
  'let',
  'new',
  'null',
  'of',
  'private',
  'protected',
  'public',
  'readonly',
  'return',
  'set',
  'static',
  'super',
  'switch',
  'this',
  'throw',
  'true',
  'try',
  'type',
  'typeof',
  'undefined',
  'var',
  'void',
  'while',
  'yield',
]);

const PYTHON_KEYWORDS = new Set([
  'and',
  'as',
  'assert',
  'async',
  'await',
  'break',
  'class',
  'continue',
  'def',
  'del',
  'elif',
  'else',
  'except',
  'False',
  'finally',
  'for',
  'from',
  'global',
  'if',
  'import',
  'in',
  'is',
  'lambda',
  'None',
  'nonlocal',
  'not',
  'or',
  'pass',
  'raise',
  'return',
  'True',
  'try',
  'while',
  'with',
  'yield',
]);

const SHELL_KEYWORDS = new Set([
  'case',
  'do',
  'done',
  'elif',
  'else',
  'esac',
  'export',
  'fi',
  'for',
  'function',
  'if',
  'in',
  'local',
  'return',
  'then',
  'until',
  'while',
]);

const JSON_KEYWORDS = new Set(['true', 'false', 'null']);

const FAMILY_BY_LANGUAGE: Record<string, LanguageFamily> = {
  bash: 'shell',
  sh: 'shell',
  shell: 'shell',
  zsh: 'shell',
  console: 'shell',
  powershell: 'shell',
  ps1: 'shell',
  js: 'c-like',
  jsx: 'c-like',
  ts: 'c-like',
  tsx: 'c-like',
  javascript: 'c-like',
  typescript: 'c-like',
  java: 'c-like',
  c: 'c-like',
  cpp: 'c-like',
  'c++': 'c-like',
  cs: 'c-like',
  csharp: 'c-like',
  go: 'c-like',
  rust: 'c-like',
  rs: 'c-like',
  php: 'c-like',
  swift: 'c-like',
  kotlin: 'c-like',
  scala: 'c-like',
  dart: 'c-like',
  py: 'python',
  python: 'python',
  json: 'json',
  jsonc: 'json',
};

export function resolveLanguageFamily(language: string): LanguageFamily {
  return FAMILY_BY_LANGUAGE[language.trim().toLowerCase()] ?? 'plain';
}

function keywordsFor(family: LanguageFamily): Set<string> {
  switch (family) {
    case 'c-like':
      return C_LIKE_KEYWORDS;
    case 'python':
      return PYTHON_KEYWORDS;
    case 'shell':
      return SHELL_KEYWORDS;
    case 'json':
      return JSON_KEYWORDS;
    default:
      return new Set<string>();
  }
}

function lineCommentPrefixes(family: LanguageFamily): readonly string[] {
  switch (family) {
    case 'c-like':
      return ['//'];
    case 'python':
    case 'shell':
      return ['#'];
    default:
      return [];
  }
}

const IDENTIFIER_START = /[A-Za-z_$]/;
const IDENTIFIER_PART = /[A-Za-z0-9_$]/;
const DIGIT = /[0-9]/;

/**
 * Tokenize one line. Line-scoped by design: a streaming code block is rendered
 * row by row and must not depend on a block-level string state that a later
 * chunk could invalidate.
 */
export function highlightLine(line: string, language: string): CodeToken[] {
  const family = resolveLanguageFamily(language);
  const keywords = keywordsFor(family);
  const commentPrefixes = lineCommentPrefixes(family);

  const tokens: CodeToken[] = [];
  let plain = '';

  const flush = (): void => {
    if (plain.length === 0) return;
    tokens.push({ kind: 'plain', text: plain });
    plain = '';
  };

  let i = 0;
  while (i < line.length) {
    const rest = line.slice(i);

    const comment = commentPrefixes.find((prefix) => rest.startsWith(prefix));
    if (comment !== undefined) {
      flush();
      tokens.push({ kind: 'comment', text: rest });
      return tokens;
    }

    const char = line.charAt(i);

    if (char === '"' || char === "'" || char === '`') {
      // Scan to the matching quote, honouring backslash escapes. An unclosed
      // quote colours to end of line rather than falling back to plain, which
      // is what a half-streamed line looks like.
      let j = i + 1;
      while (j < line.length) {
        const inner = line.charAt(j);
        if (inner === '\\') {
          j += 2;
          continue;
        }
        if (inner === char) {
          j += 1;
          break;
        }
        j += 1;
      }
      flush();
      tokens.push({
        kind: 'string',
        text: line.slice(i, Math.min(j, line.length)),
      });
      i = Math.min(j, line.length);
      continue;
    }

    if (DIGIT.test(char)) {
      let j = i;
      while (j < line.length && /[0-9a-fA-FxX._]/.test(line.charAt(j))) j += 1;
      flush();
      tokens.push({ kind: 'number', text: line.slice(i, j) });
      i = j;
      continue;
    }

    if (IDENTIFIER_START.test(char)) {
      let j = i;
      while (j < line.length && IDENTIFIER_PART.test(line.charAt(j))) j += 1;
      const word = line.slice(i, j);
      if (keywords.has(word)) {
        flush();
        tokens.push({ kind: 'keyword', text: word });
      } else {
        plain += word;
      }
      i = j;
      continue;
    }

    plain += char;
    i += 1;
  }

  flush();
  return tokens;
}

/** Reassemble tokens — used by the spec to prove nothing is lost. */
export function tokensToText(tokens: readonly CodeToken[]): string {
  return tokens.map((token) => token.text).join('');
}
