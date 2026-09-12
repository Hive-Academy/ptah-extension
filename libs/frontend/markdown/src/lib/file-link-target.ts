/**
 * File-link target parsing for links in rendered agent markdown.
 *
 * `parseFileLinkHref` decides whether a markdown link destination names a file
 * on disk, and if so returns that path plus an optional line and column. It is
 * shared by the marked link renderer (which tags file links before DOMPurify
 * runs) and the document click listener (which routes a click to the host).
 *
 * The result is a filesystem path string, never a URL. It is a hint, not an
 * authorization: the backend resolves and re-authorizes every path, so a
 * mis-parse ends as a refused open, never as a read.
 *
 * Accepted forms:
 * - relative (`src/a.ts`, `./a.ts`, `../a.ts`) and POSIX absolute (`/home/u/a.ts`);
 * - Windows drive paths (`C:\a.ts`, `c:/a.ts`) and UNC paths (`\\server\x`);
 * - `file://` URLs, percent-decoded, with `/C:/` normalised to `C:/`;
 * - a trailing `:<line>` or `:<line>:<column>`, and a `#L<line>`, `#L<line>C<col>`
 *   or `#L<line>-L<end>` fragment.
 *
 * Never a file link: empty input, `#anchor`, `?query`, protocol-relative
 * `//host`, drive-relative `C:` / `c:foo`, any other URL scheme (`http:`,
 * `mailto:`, `javascript:` ...), and input containing a control character.
 *
 * Two accepted limits:
 * 1. A POSIX file name that really ends in `:<n>` (or `:<n>:<m>`) is read as a
 *    line (and column) reference. `notes:12` opens `notes` at line 12.
 * 2. CommonMark backslash escapes are resolved by marked before this function
 *    sees the href, so `C:\a\.hidden` arrives as `C:\a.hidden`. Authors must
 *    double the backslash before punctuation.
 */

/** A file a link points at. `line` and `column` are 1-based. */
export interface MarkdownFileLinkTarget {
  readonly path: string;
  readonly line?: number;
  readonly column?: number;
}

/**
 * The attribute the marked link renderer writes the original link destination
 * into. It is transport, not trust: agent-authored HTML can carry it too, at
 * the same trust level as a markdown link.
 */
export const MARKDOWN_FILE_HREF_ATTR = 'data-ptah-file-href';

interface LinkPosition {
  readonly line: number;
  readonly column?: number;
}

const MAX_HREF_LENGTH = 4096;
const MAX_POSITION = 10_000_000;

const SCHEME_PREFIX = /^([A-Za-z][A-Za-z0-9+.-]*):/;
const DRIVE_PATH = /^[A-Za-z]:[\\/]/;
const FILE_URL_DRIVE_PATH = /^\/[A-Za-z]:(?:[\\/]|$)/;
const POSITION_ONLY = /^\d+(?::\d+)?$/;
const POSITION_SUFFIX = /:(\d+)(?::(\d+))?$/;
const LINE_FRAGMENT = /^L(\d+)(?:C(\d+))?$/i;
const LINE_RANGE_FRAGMENT = /^L(\d+)-L\d+$/i;

/**
 * Schemes that are URLs even when followed by digits (`tel:5551234`). A
 * dotless name that is not listed here and is followed only by a position
 * (`Makefile:12`) is read as a file.
 */
const URL_SCHEMES = new Set([
  'about',
  'blob',
  'data',
  'ftp',
  'ftps',
  'http',
  'https',
  'irc',
  'javascript',
  'mailto',
  'news',
  'sms',
  'ssh',
  'tel',
  'vbscript',
  'vscode',
  'ws',
  'wss',
]);

/**
 * Returns the file a link destination points at, or `null` when the link is
 * not a file link and must keep its normal behaviour.
 */
export function parseFileLinkHref(
  raw: string | null | undefined,
): MarkdownFileLinkTarget | null {
  if (typeof raw !== 'string') return null;
  const href = raw.trim();
  if (href.length === 0 || href.length > MAX_HREF_LENGTH) return null;
  if (containsControlCharacter(href)) return null;
  if (href.startsWith('#') || href.startsWith('?')) return null;

  if (!DRIVE_PATH.test(href)) {
    const scheme = SCHEME_PREFIX.exec(href);
    if (scheme) {
      const name = scheme[1].toLowerCase();
      if (name === 'file') return parseFileUrl(href);
      if (isUrlScheme(name, href.slice(scheme[0].length))) return null;
    } else if (href.startsWith('//')) {
      return null;
    }
  }

  return parseLocalPath(href);
}

/**
 * Whether `name:` starts a URL rather than a file name that contains a colon
 * (`a.ts:12`, `a.ts:stream`, `Makefile:7`).
 */
function isUrlScheme(name: string, rest: string): boolean {
  if (URL_SCHEMES.has(name)) return true;
  // A single letter is a drive without a separator: drive-relative, unsupported.
  if (name.length === 1) return true;
  // Real schemes are dotless in practice; a dot means a file extension.
  if (name.includes('.')) return false;
  return !POSITION_ONLY.test(rest);
}

function parseFileUrl(href: string): MarkdownFileLinkTarget | null {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    // degradation-audit: optional-capability - an unparseable file: URL is not
    // a file link, and null leaves the anchor with its default behaviour.
    return null;
  }

  const position = positionFromFragment(url.hash.slice(1));
  const pathname = decodeOrKeep(url.pathname);
  if (containsControlCharacter(pathname)) return null;

  // A remote host is kept in the target so the click is still swallowed; the
  // backend refuses the `//host/...` form.
  if (url.host !== '' && url.hostname.toLowerCase() !== 'localhost') {
    return withPosition(`//${url.host}${pathname}`, position);
  }

  const local = FILE_URL_DRIVE_PATH.test(pathname)
    ? pathname.slice(1)
    : pathname;
  return withPosition(local, position);
}

function parseLocalPath(href: string): MarkdownFileLinkTarget | null {
  const hashIndex = href.indexOf('#');
  const rawPath = hashIndex === -1 ? href : href.slice(0, hashIndex);
  const position =
    hashIndex === -1 ? null : positionFromFragment(href.slice(hashIndex + 1));

  const path = decodeOrKeep(rawPath);
  if (containsControlCharacter(path)) return null;
  return withPosition(path, position);
}

/**
 * Attaches the position. A fragment position wins; otherwise a trailing
 * `:<line>(:<column>)` is stripped when every number in it is a positive
 * integer no larger than 10^7. The suffix is searched after any drive prefix,
 * so the drive colon never reads as a line separator.
 */
function withPosition(
  path: string,
  fromFragment: LinkPosition | null,
): MarkdownFileLinkTarget | null {
  if (path.length === 0) return null;
  if (fromFragment) return { path, ...fromFragment };

  const prefixLength = DRIVE_PATH.test(path) ? 2 : 0;
  const body = path.slice(prefixLength);
  const match = POSITION_SUFFIX.exec(body);
  if (!match || match.index === 0) return { path };

  const line = toPosition(match[1]);
  const column = match[2] === undefined ? undefined : toPosition(match[2]);
  if (line === null || column === null) return { path };

  const stripped = path.slice(0, prefixLength + match.index);
  return column === undefined
    ? { path: stripped, line }
    : { path: stripped, line, column };
}

function positionFromFragment(fragment: string): LinkPosition | null {
  const single = LINE_FRAGMENT.exec(fragment);
  if (single) {
    const line = toPosition(single[1]);
    if (line === null) return null;
    const column = single[2] === undefined ? null : toPosition(single[2]);
    return column === null ? { line } : { line, column };
  }

  const range = LINE_RANGE_FRAGMENT.exec(fragment);
  if (range) {
    const line = toPosition(range[1]);
    return line === null ? null : { line };
  }

  return null;
}

function toPosition(digits: string): number | null {
  const value = Number(digits);
  return Number.isInteger(value) && value >= 1 && value <= MAX_POSITION
    ? value
    : null;
}

/** Percent-decodes; a malformed escape keeps the raw string. */
function decodeOrKeep(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/**
 * C0 controls and DEL. A character-code loop rather than a regexp literal,
 * because a control range in a literal is what `no-control-regex` flags.
 */
function containsControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
}
