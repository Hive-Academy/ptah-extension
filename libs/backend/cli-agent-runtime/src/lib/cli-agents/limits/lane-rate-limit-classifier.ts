/**
 * API rate-limit wording matcher (TASK_2026_857, Component 10; Req 1).
 *
 * Decides whether a lane's bounded output names an API rate limit (HTTP 429),
 * which a CLI may print while still exiting 0. Pure, like
 * `matchesAuthFailure`: no clock, no I/O, no logging, and the text is never
 * stored. The caller logs the match at debug level.
 *
 * A 429 must sit next to an API or rate wording on the same line. A bare
 * "429" or a bare "rate limit" never matches, so a 429 in a file path or a
 * line that merely discusses limits is not misread as rate limited.
 *
 * It is not quota: it never feeds `classifyLaneLimit`, `failureKind` or
 * `recordLaneLimits`.
 */

/** ptah-cli's fixed rate-limit segment, emitted by its stream loop (B10c). */
export const PTAH_API_RATE_LIMIT_SEGMENT = 'API rate limit (HTTP 429)';

/** Each text is read up to this many chars (`LIMIT_CLASSIFIER_SEGMENT_CHARS`). */
const RATE_LIMIT_TEXT_CHARS = 4 * 1024;

const RATE_LIMIT_PATTERNS: readonly RegExp[] = [
  // "API Error: Request rejected (429)" or "API Error: 429 {…}".
  /\bAPI Error\b[^\n]{0,80}?\b429\b/i,
  // "429 Kimi Code API rate limit".
  /\b429\b[^\n]{0,80}?\b(?:rate[- ]?limit(?:ed)?|too many requests)\b/i,
  // "rate limited (429)".
  /\brate[- ]?limit(?:ed)?\b[^\n]{0,80}?\b429\b/i,
];

export function matchesApiRateLimit(texts: readonly string[]): boolean {
  return texts.some((value) => {
    const text = value.slice(0, RATE_LIMIT_TEXT_CHARS);
    return (
      text.includes(PTAH_API_RATE_LIMIT_SEGMENT) ||
      RATE_LIMIT_PATTERNS.some((pattern) => pattern.test(text))
    );
  });
}