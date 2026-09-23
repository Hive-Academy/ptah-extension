/**
 * Shortens a compact feed row description to a character budget while keeping
 * trailing file names visible. Deep path tokens are cut from the LEFT first —
 * independent of the total length, because the pane visually truncates rows —
 * and any remaining overflow is cut from the RIGHT.
 */

/** A token must have at least this many path segments to be shortened. */
const PATH_SEGMENT_MIN = 3;

/** Tokens that start like `https://` are URLs, never file paths. */
const URL_PATTERN = /^[a-z][a-z0-9+.-]*:\/\//i;

/** Collapses one path token to `…` + separator + its last two segments. */
function shortenPathToken(token: string): string {
  if (URL_PATTERN.test(token)) return token;
  const separator = token.includes('\\') && !token.includes('/') ? '\\' : '/';
  const segments = token.split(separator);
  if (segments.length < PATH_SEGMENT_MIN) return token;
  return '…' + separator + segments.slice(-2).join(separator);
}

export function shortenRowText(text: string, maxLength: number): string {
  if (maxLength <= 0) return '';
  // Shorten each path token on its own, keeping the words around it.
  const withShortPaths = text
    .split(/(\s+)/)
    .map((part) => (part.trim() === '' ? part : shortenPathToken(part)))
    .join('');
  if (withShortPaths.length <= maxLength) return withShortPaths;
  return withShortPaths.slice(0, maxLength - 1).trimEnd() + '…';
}
