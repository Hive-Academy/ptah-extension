/**
 * Masked, display-only hint of a stored key (TASK_2026_555 Batch 28c).
 *
 * The hint lets a user tell WHICH key is stored without revealing it, the way
 * password managers and cloud consoles do: four bullets, a space, then the
 * last 4 characters. It is computed in the extension host, on the READ path
 * only (key status RPCs); nothing that stores a key calls it.
 *
 * SECURITY: the argument is the full secret. Never log it, never put it in an
 * error, and never return anything derived from it other than this hint.
 */

/** A stored key shorter than this gets no hint: its last 4 are too large a share of it. */
export const KEY_HINT_MIN_LENGTH = 12;

/** Four U+2022 BULLET characters, escaped so the source stays ASCII. */
const HINT_BULLETS = '\u2022\u2022\u2022\u2022';

/**
 * Four bullets + a space + the last 4 characters of the trimmed secret, or `undefined` when there
 * is no secret, it is blank, or it is shorter than {@link KEY_HINT_MIN_LENGTH}.
 * Counts Unicode code points, so a hint never ends in half a surrogate pair.
 * Never throws.
 */
export function maskKeyHint(
  secret: string | null | undefined,
): string | undefined {
  if (typeof secret !== 'string') return undefined;
  const characters = Array.from(secret.trim());
  if (characters.length < KEY_HINT_MIN_LENGTH) return undefined;
  return `${HINT_BULLETS} ${characters.slice(-4).join('')}`;
}
