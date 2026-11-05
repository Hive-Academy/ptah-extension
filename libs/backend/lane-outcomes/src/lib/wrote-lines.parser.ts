/**
 * Parse `WROTE:` lines from a subagent's final message.
 *
 * The message is untrusted. Only the last {@link WROTE_SCAN_MAX_CHARS}
 * characters are scanned. A hit is a line that, after trim, at most one
 * markdown list marker (`- ` or `* `) and at most one leading backtick, starts
 * with the case-sensitive prefix `WROTE:`, or its bold forms `**WROTE:**` and
 * `**WROTE**:`. The path is the text after that prefix, cut at the first ` — ` (U+2014). A path
 * wrapped in backticks or quotes keeps its interior, including spaces. An
 * unwrapped path ends at the first whitespace, and then loses one run of
 * trailing sentence punctuation (. , ; : ! ? ). A path with spaces must be
 * wrapped.
 * An empty path, a NUL, or a path longer than 1024 characters refuses the
 * whole message. Paths are distinct and kept in first-seen order. More than
 * 20 is `too-many`. No hit is `none`.
 */

export const WROTE_SCAN_MAX_CHARS = 16384;

/** `OutcomeReportArgsSchema` path bound (`lane-outcome.schema.ts`). */
const WROTE_PATH_MAX_CHARS = 1024;
/** `DeliverablesPayloadSchema` path count (`report-effect.ts`). */
const WROTE_MAX_PATHS = 20;
const WROTE_PREFIX = 'WROTE:';
/** Bold forms first: `**WROTE:**` would otherwise leave a `**` in the body. */
const WROTE_PREFIXES: readonly string[] = [
  '**WROTE:**',
  '**WROTE**:',
  WROTE_PREFIX,
];
/** One markdown bullet; `**` is bold, not a bullet, since a space must follow. */
const LIST_MARKER = /^[-*]\s+/;
const EM_DASH_CUT = ' \u2014 ';

export type WroteRefusal = 'none' | 'too-many' | 'malformed';

export type WroteLinesParse =
  | { readonly paths: readonly string[] }
  | { readonly refusal: WroteRefusal };

export function parseWroteLines(message: string): WroteLinesParse {
  const text =
    message.length > WROTE_SCAN_MAX_CHARS
      ? message.slice(message.length - WROTE_SCAN_MAX_CHARS)
      : message;
  const paths: string[] = [];
  const seen = new Set<string>();
  for (const line of text.split(/\r?\n/)) {
    const body = wroteBody(line);
    if (body === null) continue;
    const path = pathFromWroteBody(body);
    if (
      path.length === 0 ||
      path.includes('\0') ||
      path.length > WROTE_PATH_MAX_CHARS
    )
      return { refusal: 'malformed' };
    if (seen.has(path)) continue;
    seen.add(path);
    paths.push(path);
  }
  if (paths.length === 0) return { refusal: 'none' };
  if (paths.length > WROTE_MAX_PATHS) return { refusal: 'too-many' };
  return { paths };
}

/** Text after `WROTE:`, or null when the line is not a hit. */
function wroteBody(line: string): string | null {
  let text = line.trim().replace(LIST_MARKER, '');
  if (text.startsWith('`')) text = text.slice(1);
  const prefix = WROTE_PREFIXES.find((p) => text.startsWith(p));
  if (prefix === undefined) return null;
  return text.slice(prefix.length);
}

function pathFromWroteBody(body: string): string {
  const em = body.indexOf(EM_DASH_CUT);
  const raw = (em >= 0 ? body.slice(0, em) : body).trim();
  const wrapped = wrappedPath(raw);
  if (wrapped !== null) return wrapped;
  return unwrappedPath(raw);
}

/** Interior of one backtick or quote pair, or null when the path is bare. */
function wrappedPath(raw: string): string | null {
  const open = raw[0];
  if (open !== '`' && open !== '"' && open !== "'") return null;
  const close = raw.indexOf(open, 1);
  if (close < 0) return null;
  return raw.slice(1, close).trim();
}

/**
 * A bare path stops at whitespace or at a closing backtick left by a
 * line-level code span. Trailing sentence punctuation is not part of the path.
 */
function unwrappedPath(raw: string): string {
  const tick = raw.indexOf('`');
  let path = (tick >= 0 ? raw.slice(0, tick) : raw).trim();
  const space = path.search(/\s/);
  if (space >= 0) path = path.slice(0, space);
  return path.replace(/[.,;:!?)]+$/, '');
}
