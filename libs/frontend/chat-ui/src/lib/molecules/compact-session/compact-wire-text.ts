import { shortenToolPath } from '../../utils/tool-target.utils';

/**
 * Shortens a compact feed row description to a character budget while keeping
 * trailing file names visible. Path tokens are shortened on their own —
 * independent of the total length, because the pane visually truncates rows —
 * with the shared tool-path rule, and any remaining overflow is cut from the
 * RIGHT.
 */

/** Tokens that start like `https://` are URLs, never file paths. */
const URL_PATTERN = /^[a-z][a-z0-9+.-]*:\/\//i;

export function shortenRowText(text: string, maxLength: number): string {
  if (maxLength <= 0) return '';
  // Shorten each path token on its own, keeping the words around it.
  const withShortPaths = text
    .split(/(\s+)/)
    .map((part) =>
      part.trim() === '' || URL_PATTERN.test(part)
        ? part
        : shortenToolPath(part),
    )
    .join('');
  if (withShortPaths.length <= maxLength) return withShortPaths;
  return withShortPaths.slice(0, maxLength - 1).trimEnd() + '…';
}
