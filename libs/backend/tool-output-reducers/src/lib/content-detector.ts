/**
 * Deterministic content-kind detection for tool results.
 *
 * A caller-supplied hint always wins. Without one, the text is sniffed in a
 * fixed order — json, html, markdown, code, log, text — so the same input
 * always resolves to the same kind. Everything but the JSON check reads only
 * the first SNIFF_WINDOW chars, keeping detection cheap on large results.
 *
 * Precision over recall: a structure-specific kind needs positive structural
 * evidence; ambiguous input resolves to `text`. JSON means an object or array
 * document only; a scalar is text because there is nothing to compact and the
 * text path cuts and spools it.
 */
import type { ContentKind } from './reducer.types';

const SNIFF_WINDOW = 64 * 1024;

const HTML_TAG = /<\/?[a-z][a-z0-9-]*(?:\s[^<>]*)?\/?>/gi;
const HTML_CLOSING_TAG = /<\/[a-z][a-z0-9-]*\s*>/i;
const MIN_HTML_TAGS = 5;

const MARKDOWN_HEADING = /^#{1,6}[ \t]+\S/;
/**
 * The fence run that opens or closes a code block. Unanchored at the end, so a
 * long fence run cannot backtrack; the rest of the line is sliced off after it.
 */
const MARKDOWN_FENCE = /^\s*(`{3,}|~{3,})/;
const MIN_MARKDOWN_HEADINGS = 2;

const CODE_LINE =
  /^\s*(?:import|export|from|function|class|interface|type|enum|const|let|var|def|async|return|public|private|protected|package|namespace|using|#include|fn|impl|struct|pub|func)\b/;
const MIN_CODE_LINES = 3;
const MIN_CODE_LINE_RATIO = 0.25;

/**
 * Line-anchored structural error markers. Each is case-sensitive and matches
 * the shape a tool prints, never a bare word inside a sentence.
 */
const LOG_ERROR_MARKERS: readonly RegExp[] = [
  // Stack frame with a location: `at fn (file:10:3)` or `at file:10:3`.
  /^\s*at\s.*\([^()]*:\d+(?::\d+)?\)\s*$/,
  /^\s*at\s+\S+:\d+:\d+\s*$/,
  // `TypeError: …`, `java.lang.IllegalStateException: …` at line start.
  /^\s*[\w.$]*(?:Error|Exception)\b:/,
  // Uppercase level or test-runner verdict at line start, followed by a log
  // shape — `:` or `]`, end of line, or a path-like token (`FAIL src/a.spec.ts`,
  // `FAILED tests/x.py::test_a`, `ERROR in ./src/a.ts`) — never by prose.
  /^\s*(?:ERROR|FAIL|FAILED|FATAL)(?=[:\]]|\s*$|\s+(?:in\s+)?\S*(?:[\\/]|::|\.[A-Za-z]{1,4}\b))/,
  // Jest / mocha runner markers at line start.
  /^\s*[●✕✖]/,
  // TypeScript compiler diagnostics.
  /\berror TS\d{4,5}\b|\bTS\d{4,5}:/,
  // Python traceback header.
  /^Traceback \(most recent call last\)/,
];
/**
 * A timestamp, or a level word that has a log shape: bracketed (`[ERROR]`), or
 * followed by `:`, `|`, a `-`/`[`/`|` separator, or end of line. A bare level
 * word opening a sentence ("ERROR budgets are …") is prose, not a log prefix.
 */
const LOG_LINE_PREFIX =
  /^\s*(?:\[?\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}|\[?\d{2}:\d{2}:\d{2}|\[(?:TRACE|DEBUG|INFO|WARN|WARNING|ERROR|FATAL)\]|(?:TRACE|DEBUG|INFO|WARN|WARNING|ERROR|FATAL)(?=[:|]|\s+[-[|]|\s*$))/;
const MIN_LOG_LINES = 2;
const MIN_LOG_PREFIX_RATIO = 0.5;

/** Resolve the content kind of `text`; `hint`, when given, wins. */
export function detectContentKind(
  text: string,
  hint?: ContentKind,
): ContentKind {
  if (hint !== undefined) {
    return hint;
  }
  const body = stripBom(text).trim();
  if (body.length === 0) {
    return 'text';
  }
  if (isJson(body)) {
    return 'json';
  }
  const sample = body.slice(0, SNIFF_WINDOW);
  if (isHtml(sample)) {
    return 'html';
  }
  const lines = sample.split(/\r?\n/).filter((line) => line.trim() !== '');
  if (isMarkdown(lines)) {
    return 'markdown';
  }
  if (isCode(lines)) {
    return 'code';
  }
  if (isLog(lines)) {
    return 'log';
  }
  return 'text';
}

function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

/**
 * An object or array document that `JSON.parse` accepts. Scalars (numbers,
 * strings, `true`/`false`/`null`) are deliberately text: there is nothing to
 * compact, and the text path cuts and spools a long one.
 */
function isJson(body: string): boolean {
  const first = body[0];
  const last = body[body.length - 1];
  const bracketed =
    (first === '{' && last === '}') || (first === '[' && last === ']');
  if (!bracketed) {
    return false;
  }
  try {
    JSON.parse(body);
    return true;
  } catch {
    // degradation-audit: optional-capability — a parse failure is this
    // predicate's "not JSON" answer, not an error: fall through to the other
    // sniffers.
    return false;
  }
}

function isHtml(sample: string): boolean {
  const head = sample.slice(0, 32).toLowerCase();
  if (head.startsWith('<!doctype html') || head.startsWith('<html')) {
    return true;
  }
  if (!sample.startsWith('<') || !HTML_CLOSING_TAG.test(sample)) {
    return false;
  }
  const tags = sample.match(HTML_TAG);
  return tags !== null && tags.length >= MIN_HTML_TAGS;
}

/**
 * `#`-heading structure. A shebang first line, or `# ` lines standing between
 * source lines (the non-heading lines outside fenced blocks read as code), mean
 * the `# ` lines are comments, so neither heading rule applies.
 */
function isMarkdown(lines: readonly string[]): boolean {
  if (lines.length === 0 || lines[0].startsWith('#!')) {
    return false;
  }
  if (isCode(unfencedNonHeadingLines(lines))) {
    return false;
  }
  if (MARKDOWN_HEADING.test(lines[0])) {
    return true;
  }
  let headings = 0;
  for (const line of lines) {
    if (MARKDOWN_HEADING.test(line) && ++headings >= MIN_MARKDOWN_HEADINGS) {
      return true;
    }
  }
  return false;
}

/**
 * Lines that are neither heading-shaped nor inside a ``` / ~~~ fenced block.
 * Fences follow CommonMark: a block closes only on a fence of the same
 * character, at least as long as the opener, with nothing after it, so a
 * four-backtick block may contain triple-backtick lines. A backtick fence's
 * info string cannot contain a backtick.
 */
function unfencedNonHeadingLines(lines: readonly string[]): string[] {
  const kept: string[] = [];
  let open: { readonly char: string; readonly length: number } | undefined;
  for (const line of lines) {
    const fence = MARKDOWN_FENCE.exec(line);
    const rest = fence ? line.slice(fence[0].length) : '';
    if (open) {
      if (
        fence &&
        fence[1][0] === open.char &&
        fence[1].length >= open.length &&
        rest.trim() === ''
      ) {
        open = undefined;
      }
      continue;
    }
    if (fence && !(fence[1][0] === '`' && rest.includes('`'))) {
      open = { char: fence[1][0], length: fence[1].length };
      continue;
    }
    if (!MARKDOWN_HEADING.test(line)) {
      kept.push(line);
    }
  }
  return kept;
}

function isCode(lines: readonly string[]): boolean {
  const codeLines = lines.filter((line) => CODE_LINE.test(line)).length;
  return (
    codeLines >= MIN_CODE_LINES &&
    codeLines / lines.length >= MIN_CODE_LINE_RATIO
  );
}

function isLog(lines: readonly string[]): boolean {
  if (lines.length < MIN_LOG_LINES) {
    return false;
  }
  const seen = new Set<string>();
  let prefixed = 0;
  for (const line of lines) {
    if (LOG_ERROR_MARKERS.some((marker) => marker.test(line))) {
      return true;
    }
    const key = line.trim();
    if (seen.has(key)) {
      return true;
    }
    seen.add(key);
    if (LOG_LINE_PREFIX.test(line)) {
      prefixed++;
    }
  }
  return prefixed / lines.length >= MIN_LOG_PREFIX_RATIO;
}
