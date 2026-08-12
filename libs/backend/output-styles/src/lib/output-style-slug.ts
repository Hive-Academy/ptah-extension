/**
 * Style-name → filename slug, treated as a SECURITY boundary (Req 3.4, NFR).
 *
 * A style name is user-authored text that ends up as a path segment under
 * `.claude/output-styles/`. Everything below exists so that no input can steer
 * a write outside that directory or onto a Windows device.
 *
 * Two distinct passes, and the order matters:
 *
 *  1. PRE-NORMALISATION rejection. Path separators, colons, control characters
 *     and `..` are rejected against the RAW input, because slugification would
 *     otherwise launder them into something harmless-looking and hide the fact
 *     that the caller asked for a traversal. Rejecting early also means the
 *     error names the real problem.
 *  2. Normalisation. Only then is the text folded to `[a-z0-9-]`.
 *
 * The two code-point scans below are deliberately written as loops rather than
 * regex character classes: a class over control characters has to embed literal
 * control bytes or escapes into the source, and both have a habit of being
 * mangled by an editor or a codemod without anyone noticing. A comparison
 * against a named numeric bound cannot rot silently.
 *
 * Collision with an existing file in the target tier is NOT decided here — it
 * needs the filesystem. The writer maps that case to `FILE_EXISTS` unless the
 * caller passed `overwrite: true`.
 */
import type { OutputStyleOperationError } from '@ptah-extension/shared';

/** Longest slug we will emit. Keeps the full path well inside every platform limit. */
export const MAX_SLUG_LENGTH = 64;

/** Exclusive upper bound of the ASCII C0 control block. */
const FIRST_PRINTABLE_ASCII = 0x20;
/** DEL. */
const ASCII_DELETE = 0x7f;
/**
 * The combining-mark blocks NFKD leaves behind, as inclusive `[start, end]`
 * code-point ranges.
 *
 * The base block covers the overwhelming majority of Latin-script input. The
 * Extended and Supplement blocks hold the marks rarer scripts use; without them
 * a decomposed name folds those marks to `-` and produces a slug full of stray
 * hyphens. Safe either way — the security-relevant rejections in pass 1 run on
 * the RAW input, before any of this — but the function is named for all
 * combining marks, so it should strip them.
 */
const COMBINING_MARK_RANGES: readonly (readonly [number, number])[] = [
  /** Combining Diacritical Marks. */
  [0x0300, 0x036f],
  /** Combining Diacritical Marks Extended. */
  [0x1ab0, 0x1aff],
  /** Combining Diacritical Marks Supplement. */
  [0x1dc0, 0x1dff],
];

/**
 * Windows reserved device names. Creating `CON.md` on Windows does not create a
 * file — it opens the console device — so these are rejected rather than
 * mangled, on every platform, so a project authored on Linux stays portable.
 */
const RESERVED_DEVICE_NAMES: ReadonlySet<string> = new Set([
  'con',
  'prn',
  'aux',
  'nul',
  ...Array.from({ length: 9 }, (_, i) => `com${i + 1}`),
  ...Array.from({ length: 9 }, (_, i) => `lpt${i + 1}`),
]);

export type SlugifyStyleNameResult =
  | { readonly ok: true; readonly slug: string }
  | { readonly ok: false; readonly error: OutputStyleOperationError };

function invalid(message: string): SlugifyStyleNameResult {
  return { ok: false, error: { code: 'INVALID_NAME', message } };
}

function hasControlCharacter(value: string): boolean {
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0;
    if (code < FIRST_PRINTABLE_ASCII || code === ASCII_DELETE) return true;
  }
  return false;
}

function isCombiningMark(code: number): boolean {
  for (const [start, end] of COMBINING_MARK_RANGES) {
    if (code >= start && code <= end) return true;
  }
  return false;
}

function stripCombiningMarks(value: string): string {
  let out = '';
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0;
    if (isCombiningMark(code)) continue;
    out += char;
  }
  return out;
}

/** `con.md` → `con`; `my.style.md` → `my.style`. Only the final extension goes. */
function stripExtension(value: string): string {
  const dot = value.lastIndexOf('.');
  return dot > 0 ? value.slice(0, dot) : value;
}

function isReservedDeviceName(value: string): boolean {
  const bare = stripExtension(value.trim()).trim().toLowerCase();
  return RESERVED_DEVICE_NAMES.has(bare);
}

/**
 * Convert a user-supplied style name into a safe `.md` basename (without the
 * extension).
 *
 * Note this is a STORAGE concern only. The style still binds by its
 * frontmatter `name` (E1) — a slug never becomes an identity.
 */
export function slugifyStyleName(name: string): SlugifyStyleNameResult {
  if (typeof name !== 'string') {
    return invalid('A style name is required.');
  }

  const raw = name.trim();

  if (raw.length === 0) {
    return invalid('A style name is required.');
  }

  // --- Pass 1: reject against the raw input, before anything is laundered. ---

  if (/[/\\]/.test(raw)) {
    return invalid(
      'A style name cannot contain a path separator ("/" or "\\").',
    );
  }
  if (raw.includes(':')) {
    return invalid('A style name cannot contain a colon (":").');
  }
  if (hasControlCharacter(raw)) {
    return invalid('A style name cannot contain control characters.');
  }
  if (raw === '.' || raw === '..' || raw.includes('..')) {
    return invalid('A style name cannot contain "..".');
  }
  if (isReservedDeviceName(raw)) {
    return invalid(
      `"${raw}" is a reserved Windows device name and cannot be used as a style file name.`,
    );
  }

  // --- Pass 2: normalise. ---

  const slug = stripCombiningMarks(raw.normalize('NFKD'))
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '');

  if (slug.length === 0) {
    return invalid(
      `"${raw}" contains no letters or digits, so it cannot become a file name.`,
    );
  }

  // Truncate, then re-trim: a cut that lands on a separator would otherwise
  // leave a trailing "-".
  const capped = slug.slice(0, MAX_SLUG_LENGTH).replace(/-+$/g, '');

  if (capped.length === 0) {
    return invalid(
      `"${raw}" contains no letters or digits in its first ${MAX_SLUG_LENGTH} characters.`,
    );
  }
  // Belt-and-braces: normalisation can fold a name the raw check accepted onto
  // a device name, e.g. "con!" → "con".
  if (isReservedDeviceName(capped)) {
    return invalid(
      `"${raw}" resolves to the reserved Windows device name "${capped}".`,
    );
  }

  return { ok: true, slug: capped };
}

/** The `.md` basename a style name is stored under, once slugified. */
export function styleFileName(slug: string): string {
  return `${slug}.md`;
}
