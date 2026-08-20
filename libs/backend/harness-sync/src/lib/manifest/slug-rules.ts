/**
 * Slug admissibility and collision rules (edge case E20).
 *
 * A slug becomes a directory or file name in someone else's workspace, so the
 * strictest filesystem in play sets the bar — Windows. A slug that cannot be
 * written there is rejected at the source, once, with a report, instead of
 * producing an `EINVAL` per target and a half-written manifest.
 */

/** Windows device names. Reserved with or without an extension, any case. */
const WINDOWS_RESERVED = new Set([
  'con',
  'prn',
  'aux',
  'nul',
  ...Array.from({ length: 9 }, (_, i) => `com${i + 1}`),
  ...Array.from({ length: 9 }, (_, i) => `lpt${i + 1}`),
]);

/**
 * Punctuation no Windows path component may contain.
 *
 * Hyphens and spaces are deliberately absent: they are legal and ubiquitous in
 * skill slugs (`run-tests`). Only the nine characters NTFS actually rejects are
 * listed, plus the separators, which would turn a slug into a nested path.
 */
const ILLEGAL_CHARS = new Set(['<', '>', ':', '"', '/', '\\', '|', '?', '*']);

/**
 * True when a slug cannot safely become a path component on Windows.
 *
 * Covers device names (`CON`, `LPT1`, `nul.md`), illegal punctuation, and the
 * trailing dot or space that Windows silently strips — which would make two
 * distinct slugs resolve to one directory.
 */
export function isReservedSlug(slug: string): boolean {
  if (slug.length === 0) return true;
  if (slug === '.' || slug === '..') return true;
  for (const char of slug) {
    if (ILLEGAL_CHARS.has(char)) return true;
    if (char.charCodeAt(0) < 0x20) return true;
  }
  if (slug.endsWith('.') || slug.endsWith(' ')) return true;
  const stem = slug.split('.')[0].toLowerCase();
  return WINDOWS_RESERVED.has(stem);
}

/**
 * Canonical form for collision detection: lower-cased.
 *
 * NTFS and APFS are case-insensitive by default, so `Run-Tests` and `run-tests`
 * are one directory. Detecting that here means the second one is reported and
 * skipped, rather than silently overwriting the first on Windows while
 * producing two independent entries on Linux.
 */
export function canonicalSlug(slug: string): string {
  return slug.toLowerCase();
}
